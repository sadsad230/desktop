import { notifyLibraryChanged } from "../usePlaylists.ts";

export type MutateOptions<R = unknown> = {
  onSuccess?: (value: R) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

export type TrackMutationInput =
  | string
  | { trackId: string; [key: string]: unknown };

export const trackIdFrom = (input: TrackMutationInput) =>
  typeof input === "string" ? input : input.trackId;

const NOTIFY_DEBOUNCE_MS = 300;

let inflight = 0;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;

export function beginLibraryMutation() {
  inflight++;
  clearTimeout(notifyTimer);
}

export function endLibraryMutation() {
  inflight = Math.max(0, inflight - 1);
  clearTimeout(notifyTimer);
  if (inflight > 0) return;

  notifyTimer = setTimeout(() => {
    if (inflight === 0) notifyLibraryChanged();
  }, NOTIFY_DEBOUNCE_MS);
}

const queues = new Map<string, Promise<unknown>>();

export function runSerial<T>(
  trackId: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = queues.get(trackId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  queues.set(trackId, next);

  const cleanup = () => {
    if (queues.get(trackId) === next) queues.delete(trackId);
  };
  next.then(cleanup, cleanup);

  return next;
}
