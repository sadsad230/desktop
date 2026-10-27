type Override = {
  liked: boolean;
  pending: number;
  settledSeq: number;
};

const overrides = new Map<string, Override>();
const listeners = new Set<() => void>();
let settleSeq = 0;

function notify() {
  listeners.forEach((l) => l());
}

export function onOverridesChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const hasOverrides = () => overrides.size > 0;

export const getOverrideLiked = (trackId: string): boolean | undefined =>
  overrides.get(trackId)?.liked;

export function* overrideEntries(): Generator<[string, boolean]> {
  for (const [id, o] of overrides) yield [id, o.liked];
}

export const currentSettleSeq = () => settleSeq;

function apply(trackId: string, liked: boolean) {
  const cur = overrides.get(trackId);
  overrides.set(trackId, {
    liked,
    pending: (cur?.pending ?? 0) + 1,
    settledSeq: cur?.settledSeq ?? 0,
  });
  notify();
}

export function applyOptimisticLike(trackId: string) {
  apply(trackId, true);
}

export function applyOptimisticUnlike(trackId: string) {
  apply(trackId, false);
}

export function settleOptimistic(trackId: string, ok: boolean) {
  const o = overrides.get(trackId);
  if (!o) return;

  o.pending--;
  o.settledSeq = ++settleSeq;

  if (o.pending === 0 && !ok) overrides.delete(trackId);
  notify();
}

export function reconcileOverrides(fetchStartedSeq: number) {
  for (const [id, o] of overrides) {
    if (o.pending === 0 && o.settledSeq <= fetchStartedSeq) {
      overrides.delete(id);
    }
  }
}

export function clearOverrides() {
  overrides.clear();
}
