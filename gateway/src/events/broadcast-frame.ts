/**
 * broadcast 帧构造（spec：2026-10-22-persistent-event-replay-design.md §5.2）。
 *
 * broadcast() 的 enrich 步骤抽为纯函数（index.ts 巨类难实例化——
 * resolvePromptBudget 同模式先例）：
 * - seq 双层放置（v2 Q2）：信封顶层 + data 内（当 data 是纯 object）。
 *   两个活消费方剥壳后分发（desktop raw?.data || raw、SDK data.data）——
 *   信封级 seq 剥壳后不可见，单放顶层则客户端自检（G6）不可达。
 *   注入发生在 mafwBroadcast() 返回之后，不改信封构造函数——与顶层
 *   timestamp 同为 post-constructor additive 键先例。
 * - seq null（part.delta / store 失败）：不加键，现状形状（C5）。
 */

export function enrichBroadcastFrame(
  event: { type: string; [k: string]: any },
  seq: number | null,
  now: string,
): { type: string; [k: string]: any } {
  const out: { type: string; [k: string]: any } = { ...event, timestamp: now };
  if (seq !== null) {
    out.seq = seq;
    if (event.data !== null && typeof event.data === 'object') {
      out.data = { ...event.data, seq };
    }
  }
  return out;
}
