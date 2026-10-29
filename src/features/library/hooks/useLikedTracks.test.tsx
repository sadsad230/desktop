// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "@/shared/api";
import { captureScope } from "./likes/accountScope";
import { applyOptimisticLike, settleOptimistic } from "./likes/optimisticLikes";
import { useLikedTracks } from "./useLikedTracks";

const flush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}


type StubTrack = { id: string; title?: string; artists?: string };
type LikedPage = Awaited<ReturnType<typeof api.listLikedTracks>>;

const auth = vi.hoisted(() => ({
  session: null as { accessToken: string; user: { id: string } } | null,
}));

vi.mock("@/shared/api", () => ({
  api: {
    listLikedTracks: vi.fn(),
  },
  getAuthSession: () => auth.session,
  toClientTrack: (track: StubTrack) => ({
    id: track.id,
    title: track.title ?? "",
    artists: track.artists ?? "",
    coverUrl: "",
    durationMs: 0,
    playCount: 0,
  }),
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const listLiked = vi.mocked(api.listLikedTracks);

const page = (...ids: string[]) =>
  ({
    items: ids.map((id) => ({ track: { id, title: `Song ${id}` } })),
    nextCursor: null,
  }) as unknown as LikedPage;

const signIn = (id: string) => {
  auth.session = { accessToken: `token-${id}`, user: { id } };
};

let hookResult: ReturnType<typeof useLikedTracks> | undefined;

function TestComponent() {
  hookResult = useLikedTracks();
  return <div>loaded: {(!hookResult.isLoading).toString()}</div>;
}

const trackIds = () => hookResult?.data.tracks.map((t) => t.id);
const settle = () => act(async () => void (await flush()));
const requestRefetch = () =>
  act(async () => void window.dispatchEvent(new Event("library:changed")));
const switchTo = (id: string) =>
  act(async () => {
    signIn(id);
    window.dispatchEvent(new Event("auth:changed"));
  });

function optimisticLike(id: string) {
  const scope = captureScope();
  if (!scope) throw new Error("expected a signed-in scope");
  act(() => applyOptimisticLike(id, scope));
  return scope;
}

describe("useLikedTracks", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });
    await settle();
  };

  beforeEach(() => {
    vi.resetAllMocks();
    hookResult = undefined;
    signIn("u1");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
    auth.session = null;
    window.dispatchEvent(new Event("auth:changed"));
    await settle();
  });

  it("does not flip isLoading to true when library:changed event is dispatched after initial load", async () => {
    listLiked.mockResolvedValue(page("track-1"));
    await mount();

    expect(hookResult?.isLoading).toBe(false);
    expect(hookResult?.data.tracks).toHaveLength(1);

    optimisticLike("track-2");
    expect(hookResult?.data.tracks).toHaveLength(2);
    expect(hookResult?.isLoading).toBe(false);

    const background = deferred<LikedPage>();
    listLiked.mockReturnValue(background.promise);
    await requestRefetch();

    expect(hookResult?.isLoading).toBe(false);

    background.resolve(page("track-1", "track-2"));
    await settle();

    expect(hookResult?.isLoading).toBe(false);
    expect(hookResult?.data.tracks).toHaveLength(2);
  });

  it("keeps an optimistic like whose request is still in flight when a refetch comes back without it", async () => {
    listLiked.mockResolvedValue(page("track-1"));
    await mount();

    optimisticLike("track-2");
    await requestRefetch();
    await settle();

    expect(trackIds()).toEqual(["track-2", "track-1"]);
  });

  it("drops a settled optimistic like only after a refetch that started once it settled", async () => {
    listLiked.mockResolvedValue(page("track-1"));
    await mount();
    const scope = optimisticLike("track-2");

    const early = deferred<LikedPage>();
    listLiked.mockReturnValueOnce(early.promise);
    await requestRefetch();
    act(() => settleOptimistic("track-2", true, scope));
    early.resolve(page("track-1"));
    await settle();

    expect(trackIds()).toEqual(["track-2", "track-1"]);

    listLiked.mockResolvedValue(page("track-1", "track-2"));
    await requestRefetch();
    await settle();

    expect(trackIds()).toEqual(["track-1", "track-2"]);
  });

  describe("across account changes", () => {
    it("hides the previous account's liked tracks as soon as another account signs in", async () => {
      listLiked.mockResolvedValue(page("a-1"));
      await mount();
      expect(trackIds()).toEqual(["a-1"]);

      const forB = deferred<LikedPage>();
      listLiked.mockReturnValue(forB.promise);
      await switchTo("u2");
      expect(trackIds()).toEqual([]);

      forB.resolve(page("b-1"));
      await settle();
      expect(trackIds()).toEqual(["b-1"]);
    });

    it("discards a response that arrives for the previous account and loads the new account instead", async () => {
      const forA = deferred<LikedPage>();
      const forB = deferred<LikedPage>();
      listLiked.mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);
      await mount();

      await switchTo("u2");
      forA.resolve(page("a-1"));
      await settle();

      expect(trackIds()).toEqual([]);
      expect(listLiked).toHaveBeenCalledTimes(2);

      forB.resolve(page("b-1"));
      await settle();
      expect(trackIds()).toEqual(["b-1"]);
    });

    it("still loads the new account when no auth event was delivered", async () => {
      const forA = deferred<LikedPage>();
      const forB = deferred<LikedPage>();
      listLiked.mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);
      await mount();

      signIn("u2");
      forA.resolve(page("a-1"));
      await settle();

      expect(trackIds()).toEqual([]);
      expect(listLiked).toHaveBeenCalledTimes(2);

      forB.resolve(page("b-1"));
      await settle();
      expect(trackIds()).toEqual(["b-1"]);
    });
  });
});
