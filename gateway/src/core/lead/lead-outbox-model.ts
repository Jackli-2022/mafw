import type { EventOutboxRow } from '../events/event-types';

/**
 * Lead outbox 批量模型（纯函数）。
 *
 * `event_outbox` 只存通用 payload；这里定义 Lead chat 投递需要的最小 payload、
 * 批量选择规则（优先级 → 时间 → 预算 → 最小间隔）和合并渲染。dispatcher
 * （`lead-outbox.ts`）只负责 I/O，规则全部放在这里以便单测锁定。
 */

export type LeadOutboxPriority = 'p1' | 'p2' | 'p3';

export interface LeadOutboxPayload {
  kind: 'decision';
  priority: LeadOutboxPriority;
  text: string;
  podId: string;
  goalId: string | null;
  recordId: string;
  createdAt: string;
}

export interface LeadOutboxPolicy {
  maxPerHour: number;
  maxBatch: number;
  minIntervalMs: number;
}

export interface LeadOutboxBatchSelection {
  rows: EventOutboxRow[];
  reason: 'ok' | 'empty' | 'budget' | 'interval';
}

export const DEFAULT_LEAD_OUTBOX_POLICY: LeadOutboxPolicy = {
  maxPerHour: 6,
  maxBatch: 5,
  minIntervalMs: 60_000,
};

const PRIORITY_RANK: Record<LeadOutboxPriority, number> = {
  p1: 0,
  p2: 1,
  p3: 2,
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 解析一条 outbox row；任何必需字段缺失或类型不对都返回 null（调用方按坏数据跳过）。 */
export function leadOutboxPayload(row: EventOutboxRow): LeadOutboxPayload | null {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.kind !== 'decision') return null;

  const priority = payload.priority === undefined ? 'p2' : payload.priority;
  if (priority !== 'p1' && priority !== 'p2' && priority !== 'p3') return null;

  const goalId = payload.goalId;
  if (goalId !== undefined && goalId !== null && typeof goalId !== 'string') return null;

  if (
    !nonEmptyString(payload.text) ||
    !nonEmptyString(payload.podId) ||
    !nonEmptyString(payload.recordId) ||
    !nonEmptyString(payload.createdAt)
  ) {
    return null;
  }

  return {
    kind: 'decision',
    priority,
    text: payload.text,
    podId: payload.podId,
    goalId: typeof goalId === 'string' ? goalId : null,
    recordId: payload.recordId,
    createdAt: payload.createdAt,
  };
}

/**
 * 从一组 pending rows 里选出本轮要发的批次。
 *
 * 顺序：payload 有效 → 预算 → 最小间隔 → 优先级/时间排序 → maxBatch。
 * `budget` / `interval` 只表示“本轮不发”，行仍留在 outbox，不会被丢弃。
 */
export function selectLeadOutboxBatch(input: {
  rows: EventOutboxRow[];
  now: number;
  policy: LeadOutboxPolicy;
  sentBatchesLastHour: number;
  lastSentAt: number | null;
}): LeadOutboxBatchSelection {
  const valid = input.rows.filter((row) => leadOutboxPayload(row) !== null);
  if (valid.length === 0) return { rows: [], reason: 'empty' };

  if (input.sentBatchesLastHour >= input.policy.maxPerHour) {
    return { rows: [], reason: 'budget' };
  }

  if (input.lastSentAt !== null && input.now - input.lastSentAt < input.policy.minIntervalMs) {
    return { rows: [], reason: 'interval' };
  }

  const sorted = [...valid].sort((a, b) => {
    const pa = leadOutboxPayload(a)!;
    const pb = leadOutboxPayload(b)!;
    const byPriority = PRIORITY_RANK[pa.priority] - PRIORITY_RANK[pb.priority];
    if (byPriority !== 0) return byPriority;
    const byCreatedAt = Date.parse(pa.createdAt) - Date.parse(pb.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.id.localeCompare(b.id);
  });

  return { rows: sorted.slice(0, Math.max(1, input.policy.maxBatch)), reason: 'ok' };
}

/** 单条直接发原文；多条合并成一条带编号的消息，避免同一批决定刷屏。 */
export function renderLeadOutboxBatch(rows: EventOutboxRow[]): string {
  const payloads = rows
    .map((row) => leadOutboxPayload(row))
    .filter((payload): payload is LeadOutboxPayload => payload !== null);

  if (payloads.length === 0) return '';
  if (payloads.length === 1) return payloads[0].text;

  const blocks = payloads.map(
    (payload, index) => `--- ${index + 1} --- ${payload.recordId}\n${payload.text}`,
  );
  return `[LEAD EVENT] ${payloads.length} 条待确认\n\n${blocks.join('\n\n')}`;
}
