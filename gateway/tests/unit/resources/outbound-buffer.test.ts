/**
 * E4-5 有界出站缓冲（spec §4.5）。
 *
 * 慢客户端不能把广播缓冲拖成无上限：`res.write` 返回 false 后入队，`drain`
 * 按序冲刷；队列越界（帧数或字节）就断开连接——SSE 客户端靠 `since` /
 * Last-Event-ID 重连回放，断开是安全动作。测试用 EventEmitter 假 res，
 * 不碰真实 socket。
 */
import { EventEmitter } from 'events';
import type * as http from 'http';
import {
  BufferCounters,
  SseBoundedWriter,
  sendWsBounded,
} from '../../../src/resources/outbound-buffer';

class FakeRes extends EventEmitter {
  frames: string[] = [];
  /** Controls the next `write()` return value. */
  writeReturns = true;
  /** Applied to the next single write only (drain scenarios). */
  nextWriteReturns: boolean | null = null;
  destroyed = false;
  ended = false;
  throwOnWrite = false;

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('EPIPE');
    this.frames.push(chunk);
    const result = this.nextWriteReturns ?? this.writeReturns;
    this.nextWriteReturns = null;
    return result;
  }

  destroy(): void { this.destroyed = true; }

  end(): void { this.ended = true; }
}

function makeWriter(over: { maxFrames?: number; maxBytes?: number; counters?: BufferCounters } = {}) {
  const res = new FakeRes();
  const counters = over.counters ?? new BufferCounters();
  const overflows: string[] = [];
  const writer = new SseBoundedWriter({
    res: res as unknown as http.ServerResponse,
    maxFrames: over.maxFrames ?? 4,
    maxBytes: over.maxBytes ?? 1024,
    counters,
    onOverflow: (reason) => overflows.push(reason),
  });
  return { res, writer, counters, overflows };
}

describe('SseBoundedWriter: fast path', () => {
  it('writes straight through while the socket accepts', () => {
    const { res, writer } = makeWriter();
    writer.write('a');
    writer.write('b');

    expect(res.frames).toEqual(['a', 'b']);
    expect(writer.stats()).toEqual({ queuedFrames: 0, queuedBytes: 0, overflows: 0 });
    writer.dispose();
  });

  it('pauses after write() returns false and queues subsequent frames', () => {
    const { res, writer, counters } = makeWriter();
    res.writeReturns = false;
    writer.write('a'); // accepted, but the socket is full
    writer.write('b');
    writer.write('c');

    expect(res.frames).toEqual(['a']);
    expect(writer.stats()).toEqual({
      queuedFrames: 2,
      queuedBytes: Buffer.byteLength('b') + Buffer.byteLength('c'),
      overflows: 0,
    });
    expect(counters.snapshot()).toEqual({ sseOverflows: 0, sseDropped: 0, wsDropped: 0 });
    writer.dispose();
  });

  it('flushes the queue in order on drain', () => {
    const { res, writer } = makeWriter();
    res.writeReturns = false;
    writer.write('a');
    writer.write('b');
    writer.write('c');

    res.writeReturns = true;
    res.emit('drain');

    expect(res.frames).toEqual(['a', 'b', 'c']);
    expect(writer.stats()).toEqual({ queuedFrames: 0, queuedBytes: 0, overflows: 0 });
    writer.dispose();
  });

  it('stops flushing when the socket reports full again, resuming on the next drain', () => {
    const { res, writer } = makeWriter();
    res.writeReturns = false;
    writer.write('a');
    writer.write('b');
    writer.write('c');

    res.nextWriteReturns = false; // 'b' is written but the socket is full again
    res.emit('drain');
    expect(res.frames).toEqual(['a', 'b']);
    expect(writer.stats().queuedFrames).toBe(1);

    res.emit('drain');
    expect(res.frames).toEqual(['a', 'b', 'c']);
    expect(writer.stats().queuedFrames).toBe(0);
    writer.dispose();
  });
});

describe('SseBoundedWriter: overflow (disconnect slow client)', () => {
  it('destroys the response when the frame cap is exceeded and counts dropped frames', () => {
    const { res, writer, counters, overflows } = makeWriter({ maxFrames: 2 });
    res.writeReturns = false;
    writer.write('first'); // paused (accepted)
    writer.write('q1');
    writer.write('q2');
    expect(res.destroyed).toBe(false);

    writer.write('q3'); // queue would be 3 > 2 → overflow

    expect(res.destroyed).toBe(true);
    expect(overflows).toEqual(['limit']);
    expect(writer.stats()).toEqual({ queuedFrames: 0, queuedBytes: 0, overflows: 1 });
    expect(counters.snapshot()).toEqual({ sseOverflows: 1, sseDropped: 3, wsDropped: 0 });
    writer.dispose();
  });

  it('destroys when the byte cap is exceeded', () => {
    const { res, writer, counters, overflows } = makeWriter({ maxFrames: 100, maxBytes: 10 });
    res.writeReturns = false;
    writer.write('first');
    writer.write('12345'); // 5 bytes
    writer.write('67890'); // 10 bytes total — still allowed

    expect(res.destroyed).toBe(false);
    writer.write('x'); // 11 bytes → overflow

    expect(res.destroyed).toBe(true);
    expect(overflows).toEqual(['limit']);
    expect(counters.snapshot()).toEqual({ sseOverflows: 1, sseDropped: 3, wsDropped: 0 });
    writer.dispose();
  });

  it('falls back to end() when destroy() is unavailable', () => {
    const res = new FakeRes();
    (res as any).destroy = undefined;
    const counters = new BufferCounters();
    const writer = new SseBoundedWriter({
      res: res as unknown as http.ServerResponse,
      maxFrames: 1,
      maxBytes: 1024,
      counters,
    });
    res.writeReturns = false;
    writer.write('first');
    writer.write('q1');
    writer.write('q2');

    expect(res.ended).toBe(true);
    expect(counters.sseOverflows).toBe(1);
    writer.dispose();
  });

  it('is a no-op after overflow (no extra writes or counters)', () => {
    const { res, writer, counters } = makeWriter({ maxFrames: 1 });
    res.writeReturns = false;
    writer.write('first');
    writer.write('q1');
    writer.write('q2'); // overflow
    const framesAfterOverflow = res.frames.length;

    writer.write('dropped');
    res.emit('drain');

    expect(res.frames).toEqual(['first']);
    expect(res.frames.length).toBe(framesAfterOverflow);
    expect(counters.sseDropped).toBe(2);
    writer.dispose();
  });

  it('treats a throwing write() as a dead socket: dispose + count dropped', () => {
    const { res, writer, counters } = makeWriter();
    res.throwOnWrite = true;

    expect(() => writer.write('a')).not.toThrow();
    expect(counters.sseDropped).toBe(1);
    expect(writer.stats().overflows).toBe(0);

    // disposed: later writes do not reach the response or the counters
    res.throwOnWrite = false;
    writer.write('b');
    expect(res.frames).toEqual([]);
    expect(counters.sseDropped).toBe(1);
    writer.dispose();
  });
});

describe('SseBoundedWriter: dispose', () => {
  it('removes the drain listener and clears the queue', () => {
    const { res, writer } = makeWriter();
    res.writeReturns = false;
    writer.write('first');
    writer.write('queued');
    expect(res.listenerCount('drain')).toBe(1);

    writer.dispose();
    expect(res.listenerCount('drain')).toBe(0);
    expect(writer.stats().queuedFrames).toBe(0);

    res.writeReturns = true;
    res.emit('drain');
    expect(res.frames).toEqual(['first']);
    writer.dispose(); // idempotent
  });

  it('ignores writes after dispose', () => {
    const { res, writer } = makeWriter();
    writer.dispose();
    writer.write('late');
    expect(res.frames).toEqual([]);
  });
});

describe('sendWsBounded', () => {
  function fakeWs(bufferedAmount = 0) {
    return {
      bufferedAmount,
      sent: [] as string[],
      terminated: false,
      send(frame: string) { this.sent.push(frame); },
      terminate() { this.terminated = true; },
    };
  }

  it('sends when the buffer is under the cap', () => {
    const counters = new BufferCounters();
    const ws = fakeWs(10);
    expect(sendWsBounded(ws, 'frame', 100, counters)).toBe(true);
    expect(ws.sent).toEqual(['frame']);
    expect(ws.terminated).toBe(false);
    expect(counters.wsDropped).toBe(0);
  });

  it('terminates and counts when bufferedAmount exceeds the cap', () => {
    const counters = new BufferCounters();
    const ws = fakeWs(101);
    expect(sendWsBounded(ws, 'frame', 100, counters)).toBe(false);
    expect(ws.sent).toEqual([]);
    expect(ws.terminated).toBe(true);
    expect(counters.wsDropped).toBe(1);
  });

  it('never drops when the cap is unlimited (0)', () => {
    const counters = new BufferCounters();
    const ws = fakeWs(10 * 1024 * 1024);
    expect(sendWsBounded(ws, 'frame', 0, counters)).toBe(true);
    expect(ws.sent).toEqual(['frame']);
    expect(counters.wsDropped).toBe(0);
  });

  it('terminates and counts when send() throws (socket died mid-broadcast)', () => {
    const counters = new BufferCounters();
    const ws = {
      bufferedAmount: 0,
      terminate: jest.fn(),
      send: () => { throw new Error('socket hang up'); },
    };
    expect(sendWsBounded(ws, 'frame', 100, counters)).toBe(false);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(counters.wsDropped).toBe(1);
  });

  it('survives sockets without terminate()', () => {
    const counters = new BufferCounters();
    const ws = { bufferedAmount: 999, send: jest.fn() };
    expect(sendWsBounded(ws as any, 'frame', 100, counters)).toBe(false);
    expect(counters.wsDropped).toBe(1);
  });
});

describe('BufferCounters', () => {
  it('snapshots the three E4 counters independently', () => {
    const counters = new BufferCounters();
    counters.sseOverflows = 2;
    counters.sseDropped = 7;
    counters.wsDropped = 3;
    expect(counters.snapshot()).toEqual({ sseOverflows: 2, sseDropped: 7, wsDropped: 3 });
  });
});
