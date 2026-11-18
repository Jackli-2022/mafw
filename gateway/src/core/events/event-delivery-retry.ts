// gateway/src/core/events/event-delivery-retry.ts
// Periodic sweep for delivery backoff. `EventLayerService.evaluate` only runs
// when a thread sees new work, so a failed delivery with no follow-up event
// would otherwise wait for a restart before its next attempt.

export const EVENT_DELIVERY_RETRY_INTERVAL_MS = 30_000;

export interface EventDeliveryRetryDeps<T extends { clear(): void }> {
  every(name: string, ms: number, fn: () => void): T;
  sweep(): Promise<unknown>;
  log?(message: string): void;
}

export function startEventDeliveryRetry<T extends { clear(): void }>(
  deps: EventDeliveryRetryDeps<T>,
): T {
  let inFlight = false;
  const timer = deps.every('event:delivery-retry', EVENT_DELIVERY_RETRY_INTERVAL_MS, () => {
    if (inFlight) return;
    inFlight = true;
    void Promise.resolve()
      .then(() => deps.sweep())
      .catch((error: any) => {
        deps.log?.(`[EventLayer] delivery retry sweep failed: ${error?.message ?? error}`);
      })
      .finally(() => {
        inFlight = false;
      });
  });
  return timer;
}
