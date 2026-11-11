/**
 * E2-1 greeting 纪元 + 显式 reset（spec 2026-11-11-gateway-e2-recovery §3 E2-1）。
 *
 * 缺陷：greeting 只有 headSeq/firstReplayedSeq/truncated——客户端无法识别
 * "网关重启换了实例"或"DB 被重置"，`since > headSeq` 时网关静默回放 0 条，
 * 客户端以为已跟到最新（永久漏状态）。
 *
 * 钉住：
 *  (a) greeting 携带 deps 提供的 instanceId / schemaEpoch；
 *  (b) 正常游标（since ≤ headSeq）→ 无 reset，回放照旧；
 *  (c) 游标超前（since > headSeq）→ greeting.reset = true 且零回放帧；
 *  (d) 留存洞（truncated）语义不变，且不与 reset 混用。
 */
import { PassThrough } from 'stream';
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';
import { attachGlobalSse } from '../../../src/events/sse-attach';

function fakeRes() {
  const res = new PassThrough() as any;
  res.writeHead = () => res;
  res.chunks = [];
  res.on('data', (c: Buffer) => res.chunks.push(c.toString()));
  return res;
}

function parseFrames(res: any) {
  return res.chunks.join('').split('\n\n').filter((s: string) => s.trim()).map((s: string) => {
    const id = /(?:^|\n)id: (\d+)/.exec(s)?.[1];
    const m = /(?:^|\n)data: (.*)$/s.exec(s);
    return { id: id ? Number(id) : null, data: m ? JSON.parse(m[1]) : null };
  });
}

function makeStore(n: number) {
  const store = new EventStore(new Database(':memory:'));
  for (let i = 0; i < n; i++) store.append({ type: 'persisted_' + i });
  return store;
}

describe('attachGlobalSse greeting 纪元（E2-1 a）', () => {
  it('greeting 携带 deps 的 instanceId / schemaEpoch', () => {
    const res = fakeRes();
    attachGlobalSse({
      res,
      store: makeStore(2),
      replayLimit: 100,
      writeFrame: (r, f) => r.write(f),
      instanceId: 'inst-abc',
      schemaEpoch: 7,
    });
    const greeting = parseFrames(res)[0].data;
    expect(greeting.instanceId).toBe('inst-abc');
    expect(greeting.schemaEpoch).toBe(7);
    expect(greeting.type).toBe('connected');
  });

  it('deps 未提供时省略两个字段（旧接线/无 release 信息不崩）', () => {
    const res = fakeRes();
    attachGlobalSse({ res, store: makeStore(1), replayLimit: 100, writeFrame: (r, f) => r.write(f) });
    const greeting = parseFrames(res)[0].data;
    expect(greeting.instanceId).toBeUndefined();
    expect(greeting.schemaEpoch).toBeUndefined();
  });
});

describe('attachGlobalSse 正常游标（E2-1 b）', () => {
  it('since ≤ headSeq：正常回放且无 reset', () => {
    const res = fakeRes();
    attachGlobalSse({ res, store: makeStore(5), replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 2 });
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 3, 4, 5]);
    expect(frames[0].data.reset).toBeUndefined();
    expect(frames[0].data.truncated).toBeUndefined();
  });

  it('since === headSeq：零回放且无 reset', () => {
    const res = fakeRes();
    attachGlobalSse({ res, store: makeStore(4), replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 4 });
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null]);
    expect(frames[0].data.reset).toBeUndefined();
  });
});

describe('attachGlobalSse 游标超前（E2-1 c）', () => {
  it('since > headSeq：greeting.reset = true 且零回放帧', () => {
    const res = fakeRes();
    attachGlobalSse({ res, store: makeStore(3), replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 42 });
    const frames = parseFrames(res);
    expect(frames).toHaveLength(1); // 只有 greeting——绝无回放帧
    expect(frames[0].data.reset).toBe(true);
    expect(frames[0].data.headSeq).toBe(3);
    expect(frames[0].data.truncated).toBeUndefined(); // reset 与 truncated 互斥
  });

  it('reset 后直播帧不被超前的 since 丢弃（maxReplayed 归零）', () => {
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store: makeStore(3), replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 42 });
    // DB 重置后新事件从 headSeq+1 开始；它们必须照常直播（不能因 since=42 被过滤）
    conn.write(`id: 4\ndata: {"type":"after-reset"}\n\n`, 4);
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 4]);
    expect(frames[1].data.type).toBe('after-reset');
  });
});

describe('attachGlobalSse 留存洞（E2-1 d）', () => {
  it('重放超 limit：truncated 语义不变且不带 reset', () => {
    const res = fakeRes();
    attachGlobalSse({ res, store: makeStore(10), replayLimit: 3, writeFrame: (r, f) => r.write(f), since: 2 });
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 8, 9, 10]);
    expect(frames[0].data.firstReplayedSeq).toBe(8);
    expect(frames[0].data.truncated).toBe(true);
    expect(frames[0].data.reset).toBeUndefined();
  });
});
