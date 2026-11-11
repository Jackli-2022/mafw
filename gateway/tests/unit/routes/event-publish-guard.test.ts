/**
 * E1-2 事件发布类型守卫（spec 2026-11-11-gateway-e1-stabilization-design.md §E1-2）。
 *
 * 缺陷：`POST /api/events` 接受任意 `type`，包括 gateway/runtime 自己的保留事件名
 * （`mafw_event` 信封、EVENT_FLOW_MATRIX 的 canonical 事件、扁平事件名、runtime
 * 原生 `sync`）。外部进程可以伪造 `turn.completed` / `session.created`，写进
 * event_log 后被所有客户端回放。
 *
 * 契约：保留名 → 400 且不广播不落库；`plugin:<pkg>:*` 仍然放行并 append 一次。
 * grep 结论（2026-11-11）：gateway 内部发布全部走 `gw.broadcast()`（EventHub），
 * 不经此路由；仓库内没有合法的"保留名 HTTP 发布方"，因此无需白名单。mafw_event
 * 信封旁路本身就是伪造面，一并关闭。
 */
import * as http from 'http';
import { Readable } from 'stream';
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';
import { handleEventPublish } from '../../../src/routes/event-publish';

interface Captured {
  status: number;
  body: any;
}

function fakeRes(): { res: http.ServerResponse; out: Captured } {
  const out: Captured = { status: 0, body: null };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(chunk?: string) { out.body = chunk ? JSON.parse(chunk) : null; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

function fakeReq(body: unknown): http.IncomingMessage {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return Readable.from([raw]) as unknown as http.IncomingMessage;
}

/** 真实 EventStore：append 会自增 headSeq，用它证明"未落库"。 */
function makeDeps() {
  const store = new EventStore(new Database(':memory:'));
  const broadcasted: Array<{ type: string; [k: string]: any }> = [];
  const unknown: string[] = [];
  const deps = {
    broadcast: (event: { type: string; [k: string]: any }) => {
      broadcasted.push(event);
      store.append(event); // 与 EventHub.broadcast 的持久化路径一致
    },
    recordUnknown: (type: string) => unknown.push(type),
  };
  return { deps, store, broadcasted, unknown };
}

async function post(body: unknown) {
  const { deps, store, broadcasted, unknown } = makeDeps();
  const { res, out } = fakeRes();
  await handleEventPublish(deps, fakeReq(body), res);
  return { out, store, broadcasted, unknown };
}

describe('POST /api/events 保留事件名守卫（E1-2）', () => {
  it.each([
    'mafw_event',
    'turn.completed',
    'session.created',
    'sync',
    'connected',
    'user_question',
    'plugins.changed',
  ])('保留类型 %s → 400，不广播、不 append', async (type) => {
    const { out, store, broadcasted } = await post({ type, sessionID: 's1' });
    expect(out.status).toBe(400);
    expect(String(out.body?.error)).toMatch(/reserved/i);
    expect(broadcasted).toHaveLength(0);
    expect(store.headSeq()).toBe(0);
  });

  it('mafw_event 信封（伪造 canonical 事件）→ 400，不 append', async () => {
    const { out, store, broadcasted } = await post({
      type: 'mafw_event',
      data: { type: 'turn.completed', sessionID: 's1' },
    });
    expect(out.status).toBe(400);
    expect(String(out.body?.error)).toMatch(/reserved/i);
    expect(broadcasted).toHaveLength(0);
    expect(store.headSeq()).toBe(0);
  });

  it('plugin:<pkg>:<event> → 200 且 append 一次', async () => {
    const { out, store, broadcasted } = await post({ type: 'plugin:demo:custom', level: 'warn' });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0]).toMatchObject({ type: 'plugin:demo:custom', level: 'warn' });
    expect(store.headSeq()).toBe(1);
  });

  it('非保留的扁平自定义类型仍放行 + 遥测（既有契约不变）', async () => {
    const { out, store, broadcasted, unknown } = await post({ type: 'my_custom_event' });
    expect(out.status).toBe(200);
    expect(broadcasted).toHaveLength(1);
    expect(store.headSeq()).toBe(1);
    expect(unknown).toEqual(['my_custom_event']);
  });

  it('保留名不触发未知类型遥测（先拒绝，不进遥测）', async () => {
    const { unknown } = await post({ type: 'turn.completed' });
    expect(unknown).toEqual([]);
  });
});
