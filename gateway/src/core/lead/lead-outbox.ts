import type { EventStore } from '../events/event-store';
import type { EventOutbox } from '../events/event-outbox';
import type { EventOutboxRow } from '../events/event-types';
import {
  DEFAULT_LEAD_OUTBOX_POLICY,
  leadOutboxPayload,
  renderLeadOutboxBatch,
  selectLeadOutboxBatch,
  type LeadOutboxPolicy,
  type LeadOutboxPriority,
} from './lead-outbox-model';

/**
 * Lead chat outbox dispatcher。
 *
 * `EventLayerService.deliverContext` 只负责把决定写进 `event_outbox`；本类每 5s
 * 取 pending rows，按 channel（每个 Pod 一个 `lead:<podId>`）批量合并、按预算
 * 与最小间隔节流，然后调一次 Lead `promptAsync`。成功逐行 `sent`，失败逐行
 * `failed` 并沿用 `EventOutbox.markFailed` 的退避。
 *
 * 为什么不直接发：deterministic 入队后，重启、Lead 忙、短时间多条决定都不会
 * 丢消息或刷屏；预算和去重也只在一个地方算。
 */

export interface LeadOutboxDeps {
  store: EventStore;
  outbox: EventOutbox;
  now(): string;
  ensureLead(podId: string): Promise<{ sessionId: string }>;
  /** Lead member id, used with deliveryDelivered for A2A dedupe. */
  leadMemberId?(podId: string): string | null;
  deliveryDelivered?(messageId: string, memberId: string): boolean;
  /** Mark the mirrored pod_message delivered after a successful Lead prompt. */
  commitDelivered?(ids: string[], sessionId: string): void;
  promptAsync(input: { sessionID: string; text: string }): Promise<void>;
  timers: { every(name: string, ms: number, fn: () => void): { clear(): void } };
  policy?: Partial<LeadOutboxPolicy>;
  log?(message: string): void;
}

export interface LeadOutboxDispatchResult {
  sent: number;
  deferred: number;
  failed: number;
}

const TIMER_NAME = 'lead:outbox';
const TIMER_INTERVAL_MS = 5_000;
const BUDGET_WINDOW_MS = 60 * 60 * 1000;
/** 本 dispatcher 只拥有 `lead:*` channel；其他生产者的 outbox rows 必须原样保留。 */
const LEAD_CHANNEL_PREFIX = 'lead:';

export class LeadOutbox {
  private readonly policy: LeadOutboxPolicy;
  private readonly batchTimes = new Map<string, number[]>();
  private timer: { clear(): void } | null = null;
  private dispatching = false;

  constructor(private readonly deps: LeadOutboxDeps) {
    this.policy = { ...DEFAULT_LEAD_OUTBOX_POLICY, ...(deps.policy ?? {}) };
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.deps.timers.every(TIMER_NAME, TIMER_INTERVAL_MS, () => {
      void this.dispatch().catch((error) => {
        this.log(`lead outbox dispatch failed: ${errorMessage(error)}`);
      });
    });
  }

  stop(): void {
    this.timer?.clear();
    this.timer = null;
  }

  /** 供 kernel shutdown settle 使用：timer 已停后仍在飞的那一批必须等它落盘。 */
  isIdle(): boolean {
    return !this.dispatching;
  }

  /**
   * 写一条 decision 播报。channel 固定 `lead:<podId>`，dedupeKey 固定
   * `decision:<recordId>`，因此同一条决定重复 enqueue 只会得到一条 row。
   */
  enqueueDecision(input: {
    podId: string;
    recordId: string;
    goalId?: string | null;
    text: string;
    priority?: LeadOutboxPriority;
  }): EventOutboxRow {
    const now = this.deps.now();
    const channelId = `${LEAD_CHANNEL_PREFIX}${input.podId}`;
    this.deps.store.insertChannel({
      id: channelId,
      threadId: '*',
      kind: 'chat',
      address: { podId: input.podId },
      now,
    });
    return this.deps.outbox.enqueue({
      channelId,
      dedupeKey: `decision:${input.recordId}`,
      payload: {
        kind: 'decision',
        priority: input.priority ?? 'p2',
        text: input.text,
        podId: input.podId,
        goalId: input.goalId ?? null,
        recordId: input.recordId,
        createdAt: now,
      },
    });
  }

  /**
   * 写一条 Pod 事件播报。与 decision 共用同一个 Lead channel 和 dispatcher，
   * 但 dedupeKey 固定 `pod-event:<eventId>`，重复 scan 只保留一条。
   */
  enqueuePodEvent(input: {
    podId: string;
    eventId: string;
    text: string;
    goalId?: string | null;
    /** Mirrored pod_message id; dispatch re-checks A2A delivery. */
    messageId?: string | null;
    priority?: LeadOutboxPriority;
  }): EventOutboxRow {
    const now = this.deps.now();
    const channelId = `${LEAD_CHANNEL_PREFIX}${input.podId}`;
    this.deps.store.insertChannel({
      id: channelId,
      threadId: '*',
      kind: 'chat',
      address: { podId: input.podId },
      now,
    });
    return this.deps.outbox.enqueue({
      channelId,
      dedupeKey: `pod-event:${input.eventId}`,
      payload: {
        kind: 'pod-event',
        priority: input.priority ?? 'p2',
        text: input.text,
        podId: input.podId,
        goalId: input.goalId ?? null,
        recordId: input.eventId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        createdAt: now,
      },
    });
  }

  /** External event broadcast; dedupeKey `external:<triggerId>`. */
  enqueueExternal(input: {
    podId: string;
    triggerId: string;
    text: string;
    priority?: LeadOutboxPriority;
  }): EventOutboxRow {
    const now = this.deps.now();
    const channelId = `${LEAD_CHANNEL_PREFIX}${input.podId}`;
    this.deps.store.insertChannel({
      id: channelId,
      threadId: '*',
      kind: 'chat',
      address: { podId: input.podId },
      now,
    });
    return this.deps.outbox.enqueue({
      channelId,
      dedupeKey: `external:${input.triggerId}`,
      payload: {
        kind: 'external',
        priority: input.priority ?? 'p2',
        text: input.text,
        podId: input.podId,
        goalId: null,
        recordId: input.triggerId,
        createdAt: now,
      },
    });
  }

  async dispatch(): Promise<LeadOutboxDispatchResult> {
    if (this.dispatching) return { sent: 0, deferred: 0, failed: 0 };
    this.dispatching = true;
    const result: LeadOutboxDispatchResult = { sent: 0, deferred: 0, failed: 0 };
    try {
      const now = Date.parse(this.deps.now());
      const byChannel = new Map<string, EventOutboxRow[]>();
      for (const row of this.deps.outbox.pending()) {
        // `event_outbox` 是共享基础设施；只处理本 dispatcher 拥有的 Lead channel。
        if (!row.channelId.startsWith(LEAD_CHANNEL_PREFIX)) continue;
        if (leadOutboxPayload(row) === null) {
          // Poison row: 不属于任何已知 payload，重试永远不会成功，直接下架。
          this.deps.store.updateOutbox(row.id, {
            state: 'dropped',
            lastError: 'invalid lead outbox payload',
            updatedAt: this.deps.now(),
          });
          continue;
        }
        const group = byChannel.get(row.channelId) ?? [];
        group.push(row);
        byChannel.set(row.channelId, group);
      }

      for (const [channelId, rows] of byChannel) {
        try {
          const recent = (this.batchTimes.get(channelId) ?? []).filter((time) => time > now - BUDGET_WINDOW_MS);
          this.batchTimes.set(channelId, recent);
          const lastSentAt = recent.length > 0 ? recent[recent.length - 1] : null;

          const selection = selectLeadOutboxBatch({
            rows,
            now,
            policy: this.policy,
            sentBatchesLastHour: recent.length,
            lastSentAt,
          });
          if (selection.reason === 'empty') continue;
          if (selection.reason === 'budget' || selection.reason === 'interval') {
            result.deferred += rows.length;
            continue;
          }

          const batch = selection.rows;
          const podId = leadOutboxPayload(batch[0])!.podId;
          const leadMember = this.deps.leadMemberId?.(podId) ?? null;
          const deliverable: EventOutboxRow[] = [];
          const deliveredMessageIds: string[] = [];
          for (const row of batch) {
            const payload = leadOutboxPayload(row)!;
            if (payload.messageId && leadMember
              && this.deps.deliveryDelivered?.(payload.messageId, leadMember)) {
              // A2A delivered the mirrored message while this row waited in the
              // outbox. Do not narrate it a second time.
              this.deps.outbox.markSent(row.id);
              result.sent += 1;
              continue;
            }
            if (payload.messageId) deliveredMessageIds.push(payload.messageId);
            deliverable.push(row);
          }
          if (!deliverable.length) continue;

          const text = renderLeadOutboxBatch(deliverable);
          if (!text) {
            result.failed += this.failRows(deliverable, 'empty lead outbox message');
            continue;
          }

          let leadSessionId = '';
          try {
            const lead = await this.deps.ensureLead(podId);
            leadSessionId = lead.sessionId;
            await this.deps.promptAsync({ sessionID: lead.sessionId, text });
            if (deliveredMessageIds.length) {
              try {
                this.deps.commitDelivered?.(deliveredMessageIds, lead.sessionId);
              } catch (error) {
                // The prompt already landed; keep the row sent and surface the
                // delivery-ledger failure instead of replaying the message.
                this.log(`lead outbox commit delivered failed for ${channelId}: ${errorMessage(error)}`);
              }
            }
          } catch (error) {
            result.failed += this.failRows(deliverable, errorMessage(error));
            this.log(`lead outbox send failed for ${channelId}: ${errorMessage(error)}`);
            continue;
          }

          // prompt 已经送达：即使下面的 DB 标记失败，也计入预算，避免 60s 内重发。
          recent.push(now);
          const sentIds: string[] = [];
          try {
            for (const row of deliverable) {
              this.deps.outbox.markSent(row.id, leadSessionId);
              sentIds.push(row.id);
            }
            result.sent += deliverable.length;
          } catch (error) {
            // markSent 部分失败：已 sent 的行保持 sent，只把剩余行按失败重试。
            const remaining = deliverable.filter((row) => !sentIds.includes(row.id));
            result.sent += sentIds.length;
            result.failed += this.failRows(remaining, errorMessage(error));
            this.log(`lead outbox mark sent failed for ${channelId}: ${errorMessage(error)}`);
          }
        } catch (error) {
          // failRows 自身也可能失败（行被删 / DB 关闭）；不能让它拖垮其他 channel。
          this.log(`lead outbox channel ${channelId} dispatch failed: ${errorMessage(error)}`);
        }
      }

      return result;
    } finally {
      this.dispatching = false;
    }
  }

  status(): { pending: number; sent: number; failed: number; dropped: number } {
    const count = (state: 'pending' | 'sent' | 'failed' | 'dropped'): number =>
      this.deps.store.listOutbox(state)
        .filter((row) => row.channelId.startsWith(LEAD_CHANNEL_PREFIX))
        .length;
    return {
      pending: count('pending'),
      sent: count('sent'),
      failed: count('failed'),
      dropped: count('dropped'),
    };
  }

  private failRows(rows: EventOutboxRow[], error: string): number {
    let failed = 0;
    for (const row of rows) {
      try {
        const current = this.deps.store.getOutbox(row.id);
        if (!current || current.state === 'sent' || current.state === 'dropped') continue;
        this.deps.outbox.markFailed(row.id, error);
        failed += 1;
      } catch (markError) {
        this.log(`lead outbox mark failed failed for ${row.id}: ${errorMessage(markError)}`);
      }
    }
    return failed;
  }

  private log(message: string): void {
    this.deps.log?.(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
