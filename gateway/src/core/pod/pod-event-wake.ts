// gateway/src/core/pod/pod-event-wake.ts
// Pod event relay: every pending wake becomes a durable Lead outbox row.
// Delivery pacing, batching, retry, and Lead session ownership live in
// LeadOutbox; this class only decides *what* is waiting and when it is paused.
import type { PodEventRow } from './pod-store';

export interface PodEventWakeEvents {
  pendingWakes(podId?: string): PodEventRow[];
  /** Mark the pod event as handed to the Lead outbox. `outboxId` is durable. */
  markWakeQueued(id: string, outboxId: string): void;
  markWakeSuppressed(id: string): void;
  markWakeAttempt?(id: string): void;
}

export interface PodEventWakeDeps {
  events: PodEventWakeEvents;
  /** Enqueue one pod event into the shared Lead outbox. */
  enqueue(input: {
    podId: string;
    eventId: string;
    goalId?: string | null;
    text: string;
    priority?: 'p1' | 'p2' | 'p3';
  }): { id: string } | Promise<{ id: string }>;
  isPodPaused(podId: string): boolean;
  now?(): number;
  /** Single-flight wrapper for scans: concurrent scan() calls join the
   *  in-flight one. The gateway wires this to scheduler.submit(midground,
   *  mutexKey 'pod-event-wake', coalesce); absent = direct call. */
  runScan?: (fn: () => Promise<PodEventWakeResult>) => Promise<PodEventWakeResult>;
}

export interface PodEventWakeResult {
  /** Number of events handed to the outbox (not necessarily sent to Lead yet). */
  delivered: number;
  suppressed: number;
}

function messageIdOf(event: PodEventRow): string | null {
  try {
    const refs = event.refsJson ? JSON.parse(event.refsJson) : [];
    const hit = Array.isArray(refs) ? refs.find((r: any) => r?.kind === 'message') : null;
    return typeof hit?.id === 'string' ? hit.id : null;
  } catch {
    return null;
  }
}

function priorityOf(event: PodEventRow): 'p1' | 'p2' | 'p3' {
  if (event.severity === 'p1' || event.severity === 'p2' || event.severity === 'p3') {
    return event.severity;
  }
  return 'p2';
}

/** One event rendering; the shared outbox handles batching across events. */
export function renderPodEvent(event: PodEventRow): string {
  const lines = [
    '[POD EVENT]',
    `goal=${event.goalId ?? '-'} kind=${event.kind}`,
  ];
  if (event.title) lines.push(`title: ${event.title}`);
  if (event.summary) lines.push(`summary: ${event.summary}`);
  const messageId = messageIdOf(event);
  if (messageId) lines.push(`message: ${messageId}`);
  lines.push('处理完即可；需要用户拍板时走 ask 流程。');
  return lines.join('\n');
}

export class PodEventWake {
  constructor(private readonly deps: PodEventWakeDeps) {}

  /** Called right after an event is recorded so a p2 does not wait for the timer. */
  notify(): void {
    setTimeout(() => { void this.scan(); }, 0).unref?.();
  }

  async scan(podId?: string): Promise<PodEventWakeResult> {
    const run = this.deps.runScan ?? ((fn: () => Promise<PodEventWakeResult>) => fn());
    return run(() => this.scanInner(podId));
  }

  private async scanInner(podId?: string): Promise<PodEventWakeResult> {
    const pending = this.deps.events.pendingWakes(podId);
    if (!pending.length) return { delivered: 0, suppressed: 0 };

    const byPod = new Map<string, PodEventRow[]>();
    for (const event of pending) {
      const list = byPod.get(event.podId) ?? [];
      list.push(event);
      byPod.set(event.podId, list);
    }

    let delivered = 0;
    const suppressed = 0;
    for (const [currentPod, events] of byPod) {
      if (this.deps.isPodPaused(currentPod)) continue;
      for (const event of events) {
        try {
          const row = await this.deps.enqueue({
            podId: event.podId,
            eventId: event.id,
            goalId: event.goalId ?? null,
            text: renderPodEvent(event),
            priority: priorityOf(event),
          });
          this.deps.events.markWakeQueued(event.id, row.id);
          delivered += 1;
        } catch {
          // Leave pending: the next scan retries. The durable outbox dedupes
          // the same eventId if a previous enqueue actually committed.
        }
      }
    }
    return { delivered, suppressed };
  }
}
