/**
 * Outbound notification channel capability (kernel-v2 Phase 2).
 *
 * This is a fan-out capability: every visible, healthy channel receives the
 * event. The core broadcast() path is not replaced; channels are downstream
 * delivery adapters (mobile push, webhook, etc.).
 *
 * Failure isolation is the contract: one channel throwing, or being
 * unhealthy, never blocks the others and never throws back into the caller.
 */

import type {
  CapabilityHealth,
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';

export interface NotificationEvent {
  type: string;
  [key: string]: unknown;
}

export interface NotificationChannel {
  id: string;
  send(event: NotificationEvent): Promise<void> | void;
  health?: () => CapabilityHealth;
  dispose?(): void | Promise<void>;
}

export interface NotificationResult {
  delivered: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: string[];
}

export interface NotificationCapability {
  notify(event: NotificationEvent, scope?: CapabilityScope): Promise<NotificationResult>;
  channels(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>;
}

type Outcome =
  | { id: string; status: 'delivered' }
  | { id: string; status: 'failed'; error: string }
  | { id: string; status: 'skipped' };

function healthOf(channel: NotificationChannel): CapabilityHealth {
  try {
    return channel.health?.() ?? 'healthy';
  } catch {
    return 'failed';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createNotificationCapability(
  registry: CapabilityRegistry<NotificationChannel>,
): NotificationCapability {
  return {
    async notify(
      event: NotificationEvent,
      scope?: CapabilityScope,
    ): Promise<NotificationResult> {
      let entries: ReturnType<typeof registry.list>;
      try {
        entries = registry.list(scope);
      } catch {
        return { delivered: [], failed: [], skipped: [] };
      }

      const outcomes = await Promise.all(
        entries.map(async ({ id, value }): Promise<Outcome> => {
          if (healthOf(value) === 'failed') return { id, status: 'skipped' };
          try {
            await value.send(event);
            return { id, status: 'delivered' };
          } catch (error) {
            return { id, status: 'failed', error: messageOf(error) };
          }
        }),
      );

      return {
        delivered: outcomes
          .filter((item): item is Extract<Outcome, { status: 'delivered' }> =>
            item.status === 'delivered',
          )
          .map((item) => item.id),
        failed: outcomes
          .filter((item): item is Extract<Outcome, { status: 'failed' }> =>
            item.status === 'failed',
          )
          .map((item) => ({ id: item.id, error: item.error })),
        skipped: outcomes
          .filter((item): item is Extract<Outcome, { status: 'skipped' }> =>
            item.status === 'skipped',
          )
          .map((item) => item.id),
      };
    },

    channels(scope?: CapabilityScope) {
      return registry.list(scope).map(({ id, tier }) => ({ id, tier }));
    },
  };
}

export function registerNotificationChannel(
  registry: CapabilityRegistry<NotificationChannel>,
  channel: NotificationChannel,
  tier: CapabilityTier = 'builtin',
  scope?: CapabilityScope,
): void {
  registry.register(
    tier,
    {
      id: channel.id,
      value: channel,
      ...(channel.health ? { health: channel.health } : {}),
      ...(channel.dispose ? { dispose: () => channel.dispose!() } : {}),
    },
    scope,
  );
}

/**
 * Default channel adapter over the existing mobile push gateway. Structural
 * typing keeps this provider free of v1 composition-root imports.
 */
export function createPushNotificationChannel(
  id: string,
  gateway: { onBroadcast(event: NotificationEvent): Promise<void> | void },
): NotificationChannel {
  return {
    id,
    send: (event) => gateway.onBroadcast(event),
  };
}
