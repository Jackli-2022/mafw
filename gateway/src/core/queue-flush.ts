/**
 * flush 编排纯函数（spec：2026-10-22-session-queue-inbox-design.md §5.4）。
 *
 * 每终态一条（串行）：一次倒空会撞 runtime 自身 busy 处理（双队列竞态）。
 * flush 发出后 busySessions 将被下一 turn.started 重新置位——busy 检查
 * 同时是防重入闸（flush 的 promptAsync 触发新 turn.started 期间不再取队）。
 */
import type { SessionQueue, QueuedItem } from './session-queue';

/** idle 且有队 → 取队首；busy 或空 → null。 */
export function shouldFlush(
  queue: SessionQueue,
  busySessions: Map<string, number>,
  sessionID: string,
): QueuedItem | null {
  if (busySessions.has(sessionID)) return null;
  if (queue.size(sessionID) === 0) return null;
  return queue.dequeue(sessionID);
}
