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
import { randomUUID } from 'crypto';
import type { TimerHandle, TimerService } from '../core/timer-service';
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
  /** E2-1: 网关实例身份（releaseMetadata/runtimeIdentity 现有字段）。 */
  instanceId?: string;
  /** E2-1: 进程纪元（release-policy schemaEpoch）；客户端据此判"旧纪元"。 */
  schemaEpoch?: number;
  /**
   * E4-1: kernel 命名 timer 台账。提供时保活以 `sse:ping:<connectionId>` 登记
   * （每连接唯一，close 即 clear）；缺省退回本地 setInterval（旧行为）。
   */
  timers?: TimerService;
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
  // E1-13: reverse proxies (nginx/Tailscale funnel) buffer text/event-stream by
  // default, which turns a live stream into batch delivery. Opt out explicitly.
  'X-Accel-Buffering': 'no',
};

/** E1-13: reconnect delay advertised in the first frame (ms). */
export const SSE_RETRY_MS = 3_000;
/** E1-13: keepalive comment cadence (ms) — must stay under common 30–60s idle cuts. */
export const SSE_PING_INTERVAL_MS = 15_000;

export interface SseConnection {
  write(frame: string, seq: number | null): void;
  /** Stop the keepalive. Idempotent; also runs on `res` close. */
  dispose(): void;
  /** 本地 fallback interval（未注入 TimerService 时）；否则 null。 */
  readonly timer: NodeJS.Timeout | null;
  /** 注入 TimerService 时的命名 handle（`sse:ping:<connectionId>`）；否则 null。 */
  readonly timerHandle: TimerHandle | null;
}

/**
 * 建立 Mode A 连接：SSE 头 + greeting → （有游标且有 store 时）重放 → 排水 → 直播。
 * 返回 write(frame, seq)——broadcast 侧 per-connection 写入口。
 * 全程同步（C4）；greeting 不持久化不经 broadcast。
 *
 * E1-13: the greeting frame carries `retry: 3000` (same event block — no extra
 * frame, existing frame-count contracts hold) and a 15s `: ping` keepalive runs
 * until the response closes. Both the retry hint and the keepalive are hygiene,
 * not protocol: consumers that ignore them behave exactly as before.
 */
export function attachGlobalSse(deps: SseAttachDeps): SseConnection {
  const { res, store, replayLimit, writeFrame } = deps;
  const since = deps.since ?? null;

  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  let timerHandle: TimerHandle | null = null;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
    deps.timers?.clear(timerHandle);
    timerHandle = null;
    try { res.off?.('close', dispose); } catch { /* not an emitter */ }
  };

  // 1. 缓冲 + listener（纵深防御：无 await 约束被破坏时承重）
  const buffer: Array<{ frame: string; seq: number | null }> = [];
  let buffering = true;
  const write = (frame: string, seq: number | null): void => {
    if (buffering) buffer.push({ frame, seq });
    else writeFrame(res, frame);
  };

  // 2. 重放查询（同步 better-sqlite3）
  // E2-1: 游标超前（DB 重置 / 旧纪元）→ 显式 reset，绝不静默"回放 0 条"。
  // reset 与 truncated 互斥且优先（truncated 描述起点有洞，reset 描述游标无效）。
  const headSeq = store ? store.headSeq() : 0;
  const reset = since !== null && since > headSeq;
  const replay = (!reset && since !== null && store)
    ? store.replaySince(since, replayLimit)
    : { rows: [], firstReplayedSeq: null as number | null };

  // 3. SSE 头 + greeting（headSeq / firstReplayedSeq / truncated / reset /
  //    instanceId / schemaEpoch——全部 additive）
  res.writeHead(200, SSE_HEADERS);
  const greeting: {
    type: string;
    timestamp: string;
    vocab: string;
    headSeq: number;
    firstReplayedSeq?: number;
    truncated?: boolean;
    reset?: boolean;
    instanceId?: string;
    schemaEpoch?: number;
  } = {
    type: 'connected',
    timestamp: new Date().toISOString(),
    vocab: 'v2',
    headSeq,
  };
  if (reset) {
    greeting.reset = true;
  } else if (replay.firstReplayedSeq !== null) {
    greeting.firstReplayedSeq = replay.firstReplayedSeq;
    if (replay.firstReplayedSeq > since! + 1) greeting.truncated = true; // limit 截断或留存淘汰：起点有洞
  }
  if (deps.instanceId !== undefined) greeting.instanceId = deps.instanceId;
  if (deps.schemaEpoch !== undefined) greeting.schemaEpoch = deps.schemaEpoch;
  // `retry:` rides in the greeting block so the reconnect delay is known before
  // the first reconnect; it does not add a frame (SSE parsers share one block).
  writeFrame(res, `retry: ${SSE_RETRY_MS}\ndata: ${JSON.stringify(greeting)}\n\n`);

  // 4. 重放行写出（envelope 补 timestamp + 双层 seq，与直播帧逐字节同形）
  // reset 时 maxReplayed 归零：新纪元的直播 seq 从低处重来，不能被陈旧 since 过滤。
  let maxReplayed = reset ? 0 : (since !== null ? since : 0);
  for (const row of replay.rows) {
    const enriched = enrichBroadcastFrame(row.envelope as { type: string; [k: string]: any }, row.seq, row.ts);
    writeFrame(res, `id: ${row.seq}\ndata: ${JSON.stringify(enriched)}\n\n`);
    maxReplayed = Math.max(maxReplayed, row.seq);
  }

  // 5. 排水 + 转直播
  buffering = false;
  drainBuffer(buffer, maxReplayed, writeFrame, res);

  // 6. 保活：注释帧不进入事件流（客户端 EventSource 忽略），只防空闲断连。
  const keepAlive = (): void => {
    try {
      writeFrame(res, ': ping\n\n');
    } catch {
      dispose(); // write after the socket died: nothing left to keep alive
    }
  };
  if (deps.timers) {
    // E4-1: 每连接唯一名字（stats 按 `sse:ping` family 折叠）；close 时 clear。
    timerHandle = deps.timers.every(`sse:ping:${randomUUID()}`, SSE_PING_INTERVAL_MS, keepAlive);
  } else {
    timer = setInterval(keepAlive, SSE_PING_INTERVAL_MS);
    timer.unref?.();
  }
  try { res.on?.('close', dispose); } catch { /* not an emitter */ }

  return { write, dispose, timer, timerHandle };
}
