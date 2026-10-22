/**
 * SessionQueue — 会话队列 inbox 纯类（spec：docs/superpowers/specs/2026-10-22-session-queue-inbox-design.md §5.2）。
 *
 * `delivery:'queue'` 的 prompt 在会话 busy 时由 gateway 拦截入队（per-session FIFO），
 * 回合终态串行续发（每终态一条）。纯内存 Map——事件发射与 flush 编排在 index.ts 接线层。
 *
 * 语义要点：
 * - 幂等窗口 = 排队期（spec §7 裁决 5）：同 idempotencyKey 在队 → duplicate；
 *   dequeue 后 key 失效（跨回合幂等是 runtime/会话层职责）
 * - per-session 上限默认 32（显式 rejected，不静默丢——goal 重试语义需要明确失败信号）
 * - expireOlderThan 供防楔死清扫（v2 Q2）：过期摘除并返回被摘项（事件发射用）
 */
import { randomUUID } from 'crypto';

export interface QueuedItem {
  id: string;
  sessionID: string;
  text?: string;
  parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  agent?: string;
  model?: { providerID: string; modelID: string };
  idempotencyKey?: string;
  enqueuedAt: string;  // ISO
  source: string;      // 'http' | 'runtime' | 'milestone' | 'self-update' | 'budget' | ...
}

export type EnqueueResult =
  | { item: QueuedItem }
  | { duplicate: QueuedItem }
  | { rejected: 'limit' };

const DEFAULT_MAX_PER_SESSION = 32;

export class SessionQueue {
  private queues = new Map<string, QueuedItem[]>();

  enqueue(
    sessionID: string,
    item: Omit<QueuedItem, 'id' | 'enqueuedAt' | 'sessionID'>,
    opts?: { maxPerSession?: number },
  ): EnqueueResult {
    const arr = this.queues.get(sessionID) ?? [];
    if (item.idempotencyKey) {
      const existing = arr.find(i => i.idempotencyKey === item.idempotencyKey);
      if (existing) return { duplicate: existing };
    }
    const max = opts?.maxPerSession ?? DEFAULT_MAX_PER_SESSION;
    if (arr.length >= max) return { rejected: 'limit' };
    const full: QueuedItem = {
      ...item,
      id: `q_${randomUUID().slice(0, 8)}`,
      sessionID,
      enqueuedAt: new Date().toISOString(),
    };
    arr.push(full);
    this.queues.set(sessionID, arr);
    return { item: full };
  }

  dequeue(sessionID: string): QueuedItem | null {
    const arr = this.queues.get(sessionID);
    if (!arr || arr.length === 0) return null;
    const item = arr.shift()!;
    if (arr.length === 0) this.queues.delete(sessionID);
    return item;
  }

  cancel(sessionID: string, itemId: string): QueuedItem | null {
    const arr = this.queues.get(sessionID);
    if (!arr) return null;
    const idx = arr.findIndex(i => i.id === itemId);
    if (idx < 0) return null;
    const [item] = arr.splice(idx, 1);
    if (arr.length === 0) this.queues.delete(sessionID);
    return item;
  }

  clear(sessionID: string): QueuedItem[] {
    const arr = this.queues.get(sessionID) ?? [];
    this.queues.delete(sessionID);
    return arr;
  }

  list(sessionID: string): QueuedItem[] {
    return [...(this.queues.get(sessionID) ?? [])];
  }

  size(sessionID: string): number {
    return this.queues.get(sessionID)?.length ?? 0;
  }

  /** 当前有队列项的会话集合（清扫遍历用）。 */
  sessions(): string[] {
    return [...this.queues.keys()];
  }

  /** TTL 过期摘除（防楔死清扫用；now 注入供测试时钟控制）。返回被摘项。 */
  expireOlderThan(sessionID: string, ttlMs: number, now: number = Date.now()): QueuedItem[] {
    const arr = this.queues.get(sessionID);
    if (!arr || arr.length === 0) return [];
    const keep: QueuedItem[] = [];
    const expired: QueuedItem[] = [];
    for (const item of arr) {
      const age = now - Date.parse(item.enqueuedAt);
      if (Number.isFinite(age) && age >= ttlMs) expired.push(item);
      else keep.push(item);
    }
    if (keep.length === 0) this.queues.delete(sessionID);
    else this.queues.set(sessionID, keep);
    return expired;
  }
}
