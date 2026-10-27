import { useCallback, useState } from "react";
import { api } from "@/shared/api";
import { applyOptimisticUnlike, settleOptimistic } from "./optimisticLikes";
import {
  beginLibraryMutation,
  endLibraryMutation,
  runSerial,
  trackIdFrom,
  type MutateOptions,
  type TrackMutationInput,
} from "./mutationQueue";

export function useUnlikeTrack() {
  const [pendingCount, setPendingCount] = useState(0);

  const mutateAsync = useCallback(async (input: TrackMutationInput) => {
    const trackId = trackIdFrom(input);

    beginLibraryMutation();
    setPendingCount((n) => n + 1);
    applyOptimisticUnlike(trackId);

    let ok = false;
    try {
      const result = await runSerial(trackId, () => api.unlikeTrack(trackId));
      ok = true;
      return result;
    } finally {
      settleOptimistic(trackId, ok);
      setPendingCount((n) => n - 1);
      endLibraryMutation();
    }
  }, []);

  const mutate = useCallback(
    (input: TrackMutationInput, options?: MutateOptions) => {
      void mutateAsync(input)
        .then(
          (value) => options?.onSuccess?.(value),
          (error) => options?.onError?.(error),
        )
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync],
  );

  const isPending = pendingCount > 0;

  return { mutate, mutateAsync, isPending };
}
