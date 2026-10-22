/**
 * 回放路由 attach（spec：2026-10-22-persistent-event-replay-design.md §5.3）。
 *
 * GET /api/events Mode A 分支的连接建立器：
 * - 游标入口：?since=N 优先，Last-Event-ID 头次之（原生 EventSource 重连自动携带），
 *   垃圾/缺省 → null → 纯直播（现状行为，C6 fail-open）
 * - 缓冲-排水：attach 全同步（C4 无 await，better-sqlite3 同步查询）→ 生产中
 *   attach 期间不可能有帧到达；buffer 是"无 await 约束"的纵深防御（将来 attach
 *   加 await 时承重），其过滤规则抽为 drainBuffer 纯函数直测
 * - newest-window 回放（spec §7 裁决 8）：范围 (since, headSeq] 内最新 limit 行
 *   升序写，回放尾行恒 = headSeq 与直播无缝；洞在起点一侧由 greeting 的
 *   firstReplayedSeq 显式暴露（truncated ⟺ firstReplayedSeq > since + 1）
 */
import type * as http from 'http';
import type { EventStore } from './event-store';
import { enrichBroadcastFrame } from './broadcast-frame';

/** 游标解析：?since 非负整数优先；Last-Event-ID 头次之；垃圾/缺省 → null。 */
export function parseSince(query: URLSearchParams, lastEventIdHeader: string | undefined): number | null {
  const parse = (v: string | null | undefined): number | null =>
    typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null;
  const fromQuery = parse(query.get('since'));
  if (fromQuery !== null) return fromQuery;
  return parse(lastEventIdHeader);
}

export interface SseAttachDeps {
  res: http.ServerResponse;
  store: EventStore | null;          // null = 纯直播（C5）
  replayLimit: number;
  writeFrame: (res: http.ServerResponse, frame: string) => void;
  since?: number | null;             // 路由层 parseSince 后传入
}

/**
 * 排水过滤规则（buffer 承重时的正确性核心）：
 * - seq > maxReplayed → 写出（重放未覆盖的新帧）
 * - seq <= maxReplayed → 丢弃（重放已覆盖，防重）
 * - seq === null → 直写（part.delta / store 失败窗口期，宁重勿漏，消费方幂等）
 */
export function drainBuffer(
  buffer: Array<{ frame: string; seq: number | null }>,
  maxReplayed: number,
  writeFrame: (res: http.ServerResponse, frame: string) => void,
  res: http.ServerResponse,
): void {
  for (const entry of buffer) {
    if (entry.seq === null || entry.seq > maxReplayed) {
      writeFrame(res, entry.frame);
    }
  }
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * 建立 Mode A 连接：SSE 头 + greeting → （有游标且有 store 时）重放 → 排水 → 直播。
 * 返回 write(frame, seq)——broadcast 侧 per-connection 写入口。
 * 全程同步（C4）；greeting 不持久化不经 broadcast。
 */
export function attachGlobalSse(deps: SseAttachDeps): { write: (frame: string, seq: number | null) => void } {
  const { res, store, replayLimit, writeFrame } = deps;
  const since = deps.since ?? null;

  // 1. 缓冲 + listener（纵深防御：无 await 约束被破坏时承重）
  const buffer: Array<{ frame: string; seq: number | null }> = [];
  let buffering = true;
  const write = (frame: string, seq: number | null): void => {
    if (buffering) buffer.push({ frame, seq });
    else writeFrame(res, frame);
  };

  // 2. 重放查询（同步 better-sqlite3）
  const replay = (since !== null && store)
    ? store.replaySince(since, replayLimit)
    : { rows: [], firstReplayedSeq: null as number | null };

  // 3. SSE 头 + greeting（headSeq / firstReplayedSeq / truncated——additive）
  res.writeHead(200, SSE_HEADERS);
  const headSeq = store ? store.headSeq() : 0;
  const greeting: { type: string; timestamp: string; vocab: string; headSeq: number; firstReplayedSeq?: number; truncated?: boolean } = {
    type: 'connected',
    timestamp: new Date().toISOString(),
    vocab: 'v2',
    headSeq,
  };
  if (replay.firstReplayedSeq !== null) {
    greeting.firstReplayedSeq = replay.firstReplayedSeq;
    if (replay.firstReplayedSeq > since! + 1) greeting.truncated = true; // limit 截断或留存淘汰：起点有洞
  }
  writeFrame(res, `data: ${JSON.stringify(greeting)}\n\n`);

  // 4. 重放行写出（envelope 补 timestamp + 双层 seq，与直播帧逐字节同形）
  let maxReplayed = since !== null ? since : 0;
  for (const row of replay.rows) {
    const enriched = enrichBroadcastFrame(row.envelope as { type: string; [k: string]: any }, row.seq, row.ts);
    writeFrame(res, `id: ${row.seq}\ndata: ${JSON.stringify(enriched)}\n\n`);
    maxReplayed = Math.max(maxReplayed, row.seq);
  }

  // 5. 排水 + 转直播
  buffering = false;
  drainBuffer(buffer, maxReplayed, writeFrame, res);

  return { write };
}
