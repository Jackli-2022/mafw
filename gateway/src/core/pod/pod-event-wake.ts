// gateway/src/core/pod/pod-event-wake.ts
// Wakes the project Lead for p2 events. Deterministic gates only: budget,
// dedupe window, Pod pause, run suspension, busy merge, and "already delivered".
import type { PodEventRow } from './pod-store';

export interface PodEventWakeEvents {
  pendingWakes(podId?: string): PodEventRow[];
  markWakeDelivered(id: string, sessionId: string): void;
  markWakeSuppressed(id: string): void;
  markWakeAttempt?(id: string): void;
}

export interface PodEventWakeDeps {
  events: PodEventWakeEvents;
  leadMemberId(podId: string): string | null;
  ensureLead(podId: string): Promise<{ sessionId: string }>;
  isBusy(sessionId: string): boolean;
  isSuspended(sessionId: string): boolean;
  isPodPaused(podId: string): boolean;
  promptAsync(input: { sessionID: string; message: string }): Promise<void>;
  /** True when the mirrored pod_message was already delivered to the Lead. */
  deliveryDelivered(messageId: string, memberId: string): boolean;
  commitDelivered(ids: string[], sessionId: string): void;
  now?(): number;
  budget?: { perHour: number; dedupeMs: number };
}

export interface PodEventWakeResult {
  delivered: number;
  suppressed: number;
}

const DEFAULT_BUDGET = { perHour: 6, dedupeMs: 600_000 };

function messageIdOf(event: PodEventRow): string | null {
  try {
    const refs = event.refsJson ? JSON.parse(event.refsJson) : [];
    const hit = Array.isArray(refs) ? refs.find((r: any) => r?.kind === 'message') : null;
    return typeof hit?.id === 'string' ? hit.id : null;
  } catch {
    return null;
  }
}

export class PodEventWake {
  private wakeTimes = new Map<string, number[]>();
  private lastWakeByKey = new Map<string, number>();

  constructor(private readonly deps: PodEventWakeDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private budget(): { perHour: number; dedupeMs: number } {
    return this.deps.budget ?? DEFAULT_BUDGET;
  }

  /** Called right after an event is recorded so a p2 does not wait for the timer. */
  notify(): void {
    setTimeout(() => { void this.scan(); }, 0).unref?.();
  }

  async scan(podId?: string): Promise<PodEventWakeResult> {
    const pending = this.deps.events.pendingWakes(podId);
    if (!pending.length) return { delivered: 0, suppressed: 0 };

    const byPod = new Map<string, PodEventRow[]>();
    for (const event of pending) {
      const list = byPod.get(event.podId) ?? [];
      list.push(event);
      byPod.set(event.podId, list);
    }

    let delivered = 0;
    let suppressed = 0;
    for (const [currentPod, events] of byPod) {
      if (this.deps.isPodPaused(currentPod)) continue;

      let sessionId: string;
      try {
        sessionId = (await this.deps.ensureLead(currentPod)).sessionId;
      } catch {
        continue;
      }
      if (!sessionId) continue;
      if (this.deps.isSuspended(sessionId) || this.deps.isBusy(sessionId)) continue;

      const lead = this.deps.leadMemberId(currentPod);
      const accepted: PodEventRow[] = [];
      const priorDedupe = new Map(this.lastWakeByKey);
      const spent: number[] = [];
      for (const event of events) {
        const messageId = messageIdOf(event);
        if (messageId && lead && this.deps.deliveryDelivered(messageId, lead)) {
          this.deps.events.markWakeDelivered(event.id, sessionId);
          delivered += 1;
          continue;
        }
        const stamp = this.admit(currentPod, event, priorDedupe);
        if (stamp === null) {
          // Transient gates (budget) must not silently kill a p2 forever: only
          // give up after a few attempts, otherwise leave it pending.
          const attempts = (event.wakeAttempts ?? 0) + 1;
          if (attempts >= 3) {
            this.deps.events.markWakeSuppressed(event.id);
            suppressed += 1;
          } else {
            this.deps.events.markWakeAttempt?.(event.id);
          }
          continue;
        }
        spent.push(stamp);
        accepted.push(event);
      }
      if (!accepted.length) continue;

      try {
        await this.deps.promptAsync({ sessionID: sessionId, message: this.render(accepted) });
      } catch {
        this.refund(currentPod, spent);
        continue; // stays pending; the next scan retries
      }

      const messageIds: string[] = [];
      for (const event of accepted) {
        this.deps.events.markWakeDelivered(event.id, sessionId);
        this.lastWakeByKey.set(`${currentPod}:${event.goalId ?? '-'}:${event.kind}`, this.now());
        const messageId = messageIdOf(event);
        if (messageId) messageIds.push(messageId);
        delivered += 1;
      }
      if (messageIds.length) this.deps.commitDelivered(messageIds, sessionId);
    }
    return { delivered, suppressed };
  }

  /** Returns the budget stamp it spent, or null when a gate rejects the event. */
  private admit(podId: string, event: PodEventRow, priorDedupe: Map<string, number>): number | null {
    const now = this.now();
    const { perHour, dedupeMs } = this.budget();
    const times = (this.wakeTimes.get(podId) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= perHour) {
      this.wakeTimes.set(podId, times);
      return null;
    }
    // Member events carry no goalId; keying only by kind would collapse every
    // escalation in the window into one.
    const identity = event.goalId ?? event.id;
    const key = `${podId}:${identity}:${event.kind}`;
    const last = priorDedupe.get(key);
    if (last !== undefined && now - last < dedupeMs) return null;
    times.push(now);
    this.wakeTimes.set(podId, times);
    return now;
  }

  private refund(podId: string, stamps: number[]): void {
    if (!stamps.length) return;
    const drop = new Set(stamps);
    const times = (this.wakeTimes.get(podId) ?? []).filter((t) => !drop.has(t));
    this.wakeTimes.set(podId, times);
  }

  private render(events: PodEventRow[]): string {
    const lines = ['[POD EVENT]', `${events.length} 条待处理：`];
    events.forEach((event, index) => {
      lines.push(`${index + 1}. goal=${event.goalId ?? '-'} kind=${event.kind}`);
      if (event.title) lines.push(`   title: ${event.title}`);
      if (event.summary) lines.push(`   summary: ${event.summary}`);
      const messageId = messageIdOf(event);
      if (messageId) lines.push(`   message: ${messageId}`);
    });
    lines.push('处理完即可；需要用户拍板时走 ask 流程。');
    return lines.join('\n');
  }
}
