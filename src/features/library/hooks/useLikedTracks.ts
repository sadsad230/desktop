import { useEffect, useSyncExternalStore } from "react";
import { api, getAuthSession, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";
import {
  clearOverrides,
  currentSettleSeq,
  getOverrideLiked,
  hasOverrides,
  onOverridesChange,
  overrideEntries,
  reconcileOverrides,
} from "./likes/optimisticLikes";

type LikedData = { tracks: Track[]; total: number };
const EMPTY: LikedData = { tracks: [], total: 0 };
let cache: LikedData = EMPTY;
let loaded = false;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();
let view = { data: cache, isLoading: true };

function buildView(isLoading: boolean): {
  data: LikedData;
  isLoading: boolean;
} {
  if (!hasOverrides()) return { data: cache, isLoading };

  let tracks = cache.tracks.filter((t) => getOverrideLiked(t.id) !== false);
  for (const [id, liked] of overrideEntries()) {
    if (liked && !tracks.some((t) => t.id === id)) {
      tracks = [
        {
          id,
          title: "",
          artists: "",
          artistId: undefined,
          coverUrl: "",
          durationMs: 0,
          playCount: 0,
        } as Track,
        ...tracks,
      ];
    }
  }
  return { data: { tracks, total: tracks.length }, isLoading };
}

function emit(isLoading = false) {
  view = buildView(isLoading);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return view;
}

onOverridesChange(() => emit(false));

const SERVER_SNAPSHOT = { data: EMPTY, isLoading: true };

let refetchQueued = false;

function load(force = false): Promise<void> {
  if (request) {
    if (force) refetchQueued = true;
    return request;
  }
  const session = getAuthSession();
  if (!session?.accessToken) {
    cache = EMPTY;
    loaded = false;
    emit(false);
    return Promise.resolve();
  }
  if (loaded && !force) return Promise.resolve();

  if (!loaded) emit(true);

  const startSeq = currentSettleSeq();

  request = (async () => {
    const tracks: Track[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.listLikedTracks(100, cursor);
      tracks.push(
        ...page.items.map(({ track, likedAt }) => ({
          ...toClientTrack(track),
          addedAt: likedAt,
        })),
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    cache = { tracks, total: tracks.length };
    loaded = true;
    reconcileOverrides(startSeq);
  })()
    .catch(() => {
      if (!loaded) cache = EMPTY;
      loaded = true;
    })
    .finally(() => {
      request = null;
      emit(false);
      if (refetchQueued) {
        refetchQueued = false;
        void load(true);
      }
    });
  return request;
}

if (typeof window !== "undefined") {
  const handleRefresh = () => {
    const session = getAuthSession();
    if (!session?.accessToken) {
      cache = EMPTY;
      loaded = false;
      clearOverrides();
      emit(false);
    } else {
      void load(true);
    }
  };
  window.addEventListener("library:changed", handleRefresh);
  window.addEventListener("auth:changed", handleRefresh);
}

export function useLikedTracks(_params?: { limit?: number; offset?: number }) {
  const state = useSyncExternalStore(
    subscribe,
    snapshot,
    () => SERVER_SNAPSHOT,
  );
  useEffect(() => {
    void load();
  }, []);
  return state;
}

export function useLikedTrackCount() {
  const { data, isLoading } = useLikedTracks();
  return { data: data.total, isLoading };
}
