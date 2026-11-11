import { limitOf } from './settings';

/**
 * E4-5 有界出站缓冲（spec §4.5）。
 *
 * SSE：`res.write` 的返回值一直被忽略。返回 false = 内核缓冲已满，再写只会
 * 让 Node 的 writable buffer 无限增长。`SseBoundedWriter` 把后续帧收进自己的
 * 队列，`drain` 时按原序冲刷；队列超过帧数/字节上限就主动断开慢客户端。
 * 断开是安全动作：SSE 客户端用 `since` / Last-Event-ID 重连回放。
 *
 * WS：`ws.send` 从不报错，慢设备只是让 `bufferedAmount` 增长。广播前检查
 * 上限，超限 `terminate()`；WS 是 live-only，重连后走 REST 快照（E2 裁决）。
 *
 * 计数与 writer 实例解耦（`BufferCounters` 由 kernel 持有），因为 SSE writer
 * 每连接一个，而 stats 需要一个聚合口径。
 */
export class BufferCounters {
  sseOverflows = 0;
  sseDropped = 0;
  wsDropped = 0;

  snapshot(): { sseOverflows: number; sseDropped: number; wsDropped: number } {
    return { sseOverflows: this.sseOverflows, sseDropped: this.sseDropped, wsDropped: this.wsDropped };
  }
}

/** `http.ServerResponse` 的结构子集（测试用假 res 不需要真 socket）。 */
export interface SseResponseLike {
  write(chunk: string): boolean;
  destroy?(): void;
  end?(): void;
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
  removeListener?(event: string, listener: () => void): unknown;
}

export type SseOverflowReason = 'limit' | 'write_error';

export interface SseBoundedWriterOptions {
  res: SseResponseLike;
  /** 队列帧数上限；`0`/非有限值 = 不限。 */
  maxFrames: number;
  /** 队列字节上限；`0`/非有限值 = 不限。 */
  maxBytes: number;
  counters?: BufferCounters;
  onOverflow?: (reason: SseOverflowReason) => void;
}

export interface SseWriterStats {
  queuedFrames: number;
  queuedBytes: number;
  overflows: number;
}

interface QueuedFrame {
  frame: string;
  bytes: number;
}

export class SseBoundedWriter {
  private readonly res: SseResponseLike;
  private readonly framesCap: number;
  private readonly bytesCap: number;
  private readonly counters: BufferCounters | undefined;
  private readonly onOverflow: ((reason: SseOverflowReason) => void) | undefined;

  private queue: QueuedFrame[] = [];
  private queuedBytes = 0;
  private paused = false;
  private disposed = false;
  private overflowed = false;
  private overflowCount = 0;

  private readonly handleDrain = (): void => this.flush();

  constructor(opts: SseBoundedWriterOptions) {
    this.res = opts.res;
    this.framesCap = limitOf(opts.maxFrames);
    this.bytesCap = limitOf(opts.maxBytes);
    this.counters = opts.counters;
    this.onOverflow = opts.onOverflow;
    try {
      this.res.on?.('drain', this.handleDrain);
    } catch { /* response already gone */ }
  }

  /**
   * 写一帧：socket 可写时直写；返回 false 后进入 paused，后续帧入队。
   * 越界 → 断开 + 计数；dispose/overflow 之后的写入是 no-op。
   */
  write(frame: string): void {
    if (this.disposed || this.overflowed) return;

    if (!this.paused) {
      try {
        if (!this.res.write(frame)) this.paused = true;
      } catch {
        this.markWriteError();
      }
      return;
    }

    const bytes = Buffer.byteLength(frame);
    this.queue.push({ frame, bytes });
    this.queuedBytes += bytes;
    if (this.queue.length > this.framesCap || this.queuedBytes > this.bytesCap) {
      this.markOverflow();
    }
  }

  /** 幂等：移除 drain listener 并清空队列（连接关闭时调用）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachDrain();
    this.queue = [];
    this.queuedBytes = 0;
  }

  stats(): SseWriterStats {
    return { queuedFrames: this.queue.length, queuedBytes: this.queuedBytes, overflows: this.overflowCount };
  }

  /** `drain`：按入队顺序冲刷，直到再次满或队空。 */
  private flush(): void {
    if (this.disposed || this.overflowed) return;
    this.paused = false;
    while (!this.paused && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.queuedBytes = Math.max(0, this.queuedBytes - item.bytes);
      try {
        if (!this.res.write(item.frame)) this.paused = true;
      } catch {
        this.markWriteError();
        return;
      }
    }
    if (this.queue.length === 0) this.queuedBytes = 0;
  }

  /** 队列越界：丢掉全部未发送帧并断开连接（客户端重连回放）。 */
  private markOverflow(): void {
    const dropped = this.queue.length;
    this.queue = [];
    this.queuedBytes = 0;
    this.overflowed = true;
    this.overflowCount += 1;
    this.detachDrain();

    if (this.counters) {
      this.counters.sseOverflows += 1;
      this.counters.sseDropped += dropped;
    }

    try {
      if (typeof this.res.destroy === 'function') this.res.destroy();
      else this.res.end?.();
    } catch {
      try { this.res.end?.(); } catch { /* already gone */ }
    }
    this.emitOverflow('limit');
  }

  /** `res.write` 抛错 = socket 已死：停止写入并记一次丢弃。 */
  private markWriteError(): void {
    this.disposed = true;
    this.queue = [];
    this.queuedBytes = 0;
    this.detachDrain();
    if (this.counters) this.counters.sseDropped += 1;
    this.emitOverflow('write_error');
  }

  private detachDrain(): void {
    try {
      if (this.res.off) this.res.off('drain', this.handleDrain);
      else this.res.removeListener?.('drain', this.handleDrain);
    } catch { /* not an emitter / already removed */ }
  }

  private emitOverflow(reason: SseOverflowReason): void {
    try {
      this.onOverflow?.(reason);
    } catch { /* observers must not break the close path */ }
  }
}

/** `ws` 的结构子集（测试用假 socket）。 */
export interface WsSendLike {
  bufferedAmount?: number;
  send(frame: string): void;
  terminate?(): void;
}

function terminateQuietly(ws: WsSendLike): void {
  try { ws.terminate?.(); } catch { /* already closed */ }
}

/**
 * 广播前检查 WS 背压：`bufferedAmount > cap` 或 `send` 抛错 → terminate +
 * 计数 + 返回 false（调用方从广播集合删除，push 兜底视为未送达）。
 * `cap` 的 0/非有限值 = 不限（与 config 语义一致）。
 */
export function sendWsBounded(
  ws: WsSendLike,
  frame: string,
  maxBufferedBytes: number,
  counters?: BufferCounters,
): boolean {
  const cap = limitOf(maxBufferedBytes);
  try {
    const buffered = typeof ws.bufferedAmount === 'number' ? ws.bufferedAmount : 0;
    if (buffered > cap) {
      terminateQuietly(ws);
      if (counters) counters.wsDropped += 1;
      return false;
    }
    ws.send(frame);
    return true;
  } catch {
    terminateQuietly(ws);
    if (counters) counters.wsDropped += 1;
    return false;
  }
}
