import { PassThrough } from 'stream';
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';
import { parseSince, attachGlobalSse, drainBuffer } from '../../../src/events/sse-attach';
import { readFileSync } from 'fs';
import { join } from 'path';

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
    return { id: id ? Number(id) : null, data: m ? JSON.parse(m[1]) : null, raw: s };
  });
}

describe('parseSince（C6：?since 优先 / header 次之 / 垃圾 fail-open）', () => {
  it('?since 优先于 header；垃圾 fail-open', () => {
    expect(parseSince(new URLSearchParams('since=42'), '7')).toBe(42);
    expect(parseSince(new URLSearchParams(''), '7')).toBe(7);
    expect(parseSince(new URLSearchParams('since=abc'), '7')).toBe(7);          // 垃圾参数回退 header
    expect(parseSince(new URLSearchParams('since=-3'), undefined)).toBeNull();  // 负数 = 无游标
    expect(parseSince(new URLSearchParams(''), 'garbage')).toBeNull();
    expect(parseSince(new URLSearchParams(''), undefined)).toBeNull();
    expect(parseSince(new URLSearchParams('since=0'), undefined)).toBe(0);      // 0 = 全量回放
  });
});

describe('attachGlobalSse（spec §5.3）', () => {
  function makeStore(n: number) {
    const s = new EventStore(new Database(':memory:'));
    for (let i = 0; i < n; i++) s.append({ type: 'persisted_' + i });
    return s;
  }
  it('无游标：greeting + 纯直播（现状行为）', () => {
    const store = makeStore(3);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f) });
    conn.write(`id: 4\ndata: {}\n\n`, 4);
    const frames = parseFrames(res);
    expect(frames[0].data.type).toBe('connected');
    expect(frames[0].data.headSeq).toBe(3);
    expect(frames[0].data.firstReplayedSeq).toBeUndefined();
    expect(frames).toHaveLength(2);
  });
  it('有游标：重放后直播，衔接无重无漏（Review Focus #2）', () => {
    const store = makeStore(5);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 0 });
    conn.write(`id: 6\ndata: {"type":"live"}\n\n`, 6); // 模拟 attach 后到达的直播帧
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 1, 2, 3, 4, 5, 6]);  // greeting 无 id，重放 1-5，直播 6
    expect(frames[0].data.firstReplayedSeq).toBe(1);
    expect(frames[0].data.truncated).toBeUndefined();
  });
  it('重放超 limit：newest-window + truncated 信号（Review Focus #4）', () => {
    const store = makeStore(10);
    const res = fakeRes();
    attachGlobalSse({ res, store, replayLimit: 3, writeFrame: (r, f) => r.write(f), since: 2 });
    const frames = parseFrames(res);
    expect(frames.map(f => f.id).slice(1)).toEqual([8, 9, 10]);
    expect(frames[0].data.firstReplayedSeq).toBe(8);
    expect(frames[0].data.truncated).toBe(true);
  });
  it('drainBuffer：maxReplayed 过滤 + 无 seq 帧直写（Review Focus #3）', () => {
    // 诚实裁决（自审修正）：attach 全同步（C4）→ 生产中 attach 期间不可能有帧到达；
    // buffer 是"无 await 约束"的纵深防御（将来 attach 加 await 时承重）。其过滤规则
    // 抽为导出纯函数 drainBuffer 直测：seq > maxReplayed 写出、seq <= 丢弃、
    // 无 seq（part.delta/store 失败）直写（宁重勿漏）。
    const written: string[] = [];
    const res = fakeRes();
    const buffer = [
      { frame: 'f5', seq: 5 }, { frame: 'fd', seq: null }, { frame: 'f3', seq: 3 }, { frame: 'f7', seq: 7 },
    ];
    drainBuffer(buffer, 4, (r, f) => written.push(f), res);
    expect(written).toEqual(['f5', 'fd', 'f7']); // f3 被重放覆盖，丢弃
  });
  it('store null：greeting(headSeq 0) + 纯直播（C5）', () => {
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store: null, replayLimit: 100, writeFrame: (r, f) => r.write(f) });
    conn.write(`data: {"type":"x"}\n\n`, null);
    const frames = parseFrames(res);
    expect(frames[0].data.headSeq).toBe(0);
    expect(frames).toHaveLength(2);
  });
  it('游标= headSeq：零重放，纯直播', () => {
    const store = makeStore(4);
    const res = fakeRes();
    const conn = attachGlobalSse({ res, store, replayLimit: 100, writeFrame: (r, f) => r.write(f), since: 4 });
    conn.write(`id: 5\ndata: {}\n\n`, 5);
    const frames = parseFrames(res);
    expect(frames.map(f => f.id)).toEqual([null, 5]);
  });
});

// wiring 断言（Phase D1 Task H2 起 SSE 路由体在 routes/events-sse.ts，registry
// dispatch 的 event.subscribe 接管；同一份 parseSince + attachGlobalSse 链路）：
// D3 Task 6: attach 调用从 index.ts 搬入 subsystems/api-routes.ts（字面量随迁）。
// D3 Task 7: sseClients 容器归 server/event-hub.ts 所有，kernel 经 live getter 交给
// SSE 路由（identity 承重：broadcast 与 attach 写同一 Map）。
// D3 Task 8: 组合根（class MafwScheduler）在 kernel.ts。
const src = readFileSync(join(__dirname, '../../../src/kernel.ts'), 'utf8');
const hubSrc = readFileSync(join(__dirname, '../../../src/server/event-hub.ts'), 'utf8');
const attachSrc = readFileSync(join(__dirname, '../../../src/subsystems/api-routes.ts'), 'utf8');
const sseRouteSrc = readFileSync(join(__dirname, '../../../src/routes/events-sse.ts'), 'utf8');
describe('SSE 回放接线（wiring）', () => {
  it('SSE 路由经 parseSince + attachGlobalSse', () => {
    expect(sseRouteSrc).toContain('parseSince(');
    expect(sseRouteSrc).toContain('attachGlobalSse(');
    // 组合根仍必须把该模块挂到 registry（否则 handed-off 分支无人接管）。
    expect(attachSrc).toContain('attachEventsSseRoutes(deps.routeRegistry');
  });
  it('sseClients 为 Map（per-connection write 闭包）', () => {
    expect(hubSrc).toMatch(/sseClients[^\n]*Map</);
    // 组合根交出的是 hub 的同一个 Map（不是副本）。
    expect(src).toContain('self.eventHub.sseClients');
  });
});
