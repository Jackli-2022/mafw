/**
 * E5b-1：`GET /api/events/replay` 路由（internal 恢复面）。
 *
 * 覆盖：
 *   - 参数解析：since 非负整数（缺省 0，非法 400）；limit 1..1000（缺省 500，
 *     非数字 / <=0 / 小数 400，>1000 clamp）；
 *   - 响应语义：reset / truncated / hasMore / nextSince；
 *   - 空 store / 默认页 / envelope 投影；
 *   - `EventReplayResponse` schema 校验（handler 真实 body 过 TypeBox）；
 *   - catalog 登记（operationId `event.replay`、tags internal、response schema）。
 *
 * 可达性（`attachHandler('event.replay')` 字面量）由
 * `tests/unit/api-contract.test.ts` 的全局守卫锁定；本文件的 attach 不抛错是本地证据。
 *
 * Spec: docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md §3.2
 */
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { Value } from '@sinclair/typebox/value';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachEventsReplayRoute } from '../../../src/routes/events-replay';
import { EventReplayResponse } from '../../../src/routes/schemas/events';

interface ReplayArgs {
  since: number;
  limit: number;
}

function makeRes() {
  const res = new EventEmitter() as any as ServerResponse & { statusCode?: number; body?: string };
  (res as any).writeHead = (status: number) => { (res as any).statusCode = status; return res; };
  (res as any).end = (body?: any) => { (res as any).body = body; };
  return res;
}

function makeReq(url: string): IncomingMessage {
  return { url, method: 'GET', headers: {} } as unknown as IncomingMessage;
}

function fakeStore(page: {
  rows?: Array<{ seq: number; ts: string; type: string; sessionId: string | null; envelope: unknown }>;
  headSeq?: number;
  oldestSeq?: number;
}) {
  const calls: ReplayArgs[] = [];
  const store = {
    replayAfter(since: number, limit: number) {
      calls.push({ since, limit });
      return {
        rows: page.rows ?? [],
        headSeq: page.headSeq ?? 0,
        oldestSeq: page.oldestSeq ?? 0,
      };
    },
  };
  return { store, calls };
}

function buildHandler(store: unknown) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachEventsReplayRoute(registry, { eventStore: () => store as any });
  const match = registry.match('GET', '/api/events/replay');
  if (!match?.def.handler) throw new Error('event.replay handler not attached');
  return match.def.handler;
}

async function call(url: string, store: unknown) {
  const handler = buildHandler(store);
  const res = makeRes();
  await handler(makeReq(url), res, {});
  const body = res.body ? JSON.parse(res.body) : undefined;
  return { res, body };
}

const rows = [
  { seq: 1, ts: '2026-11-12T00:00:00.000Z', type: 'mafw_event', sessionId: 'ses_a', envelope: { type: 'mafw_event', seq: 1 } },
  { seq: 2, ts: '2026-11-12T00:00:01.000Z', type: 'mafw_event', sessionId: null, envelope: { type: 'mafw_event', seq: 2 } },
];

describe('GET /api/events/replay: 参数解析', () => {
  test('缺省 since=0 / limit=500', async () => {
    const { store, calls } = fakeStore({ rows, headSeq: 2, oldestSeq: 1 });
    const { res, body } = await call('/api/events/replay', store);
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ since: 0, limit: 500 }]);
    expect(body.events.map((e: any) => e.seq)).toEqual([1, 2]);
  });

  test('since 非法（非整数 / 负数 / 小数 / 空串）→ 400 invalid since，不查 store', async () => {
    for (const raw of ['abc', '-1', '1.5', '', ' 1', '1e3']) {
      const { store, calls } = fakeStore({});
      const { res, body } = await call(`/api/events/replay?since=${encodeURIComponent(raw)}`, store);
      expect({ raw, status: res.statusCode, body }).toEqual({ raw, status: 400, body: { error: 'invalid since' } });
      expect(calls).toEqual([]);
    }
  });

  test('limit 非法（非数字 / 0 / 负数 / 小数 / 空串）→ 400 invalid limit', async () => {
    for (const raw of ['abc', '0', '-1', '2.5', '']) {
      const { store, calls } = fakeStore({});
      const { res, body } = await call(`/api/events/replay?limit=${encodeURIComponent(raw)}`, store);
      expect({ raw, status: res.statusCode, body }).toEqual({ raw, status: 400, body: { error: 'invalid limit' } });
      expect(calls).toEqual([]);
    }
  });

  test('limit > 1000 clamp 到 1000；1000 原样', async () => {
    const big = fakeStore({});
    await call('/api/events/replay?limit=5000', big.store);
    expect(big.calls).toEqual([{ since: 0, limit: 1000 }]);

    const exact = fakeStore({});
    await call('/api/events/replay?limit=1000', exact.store);
    expect(exact.calls).toEqual([{ since: 0, limit: 1000 }]);
  });

  test('since 合法值直传 store', async () => {
    const { store, calls } = fakeStore({ headSeq: 5, oldestSeq: 1 });
    await call('/api/events/replay?since=42&limit=3', store);
    expect(calls).toEqual([{ since: 42, limit: 3 }]);
  });
});

describe('GET /api/events/replay: 响应语义', () => {
  test('正常页：events 投影 seq/ts/type/sessionId/envelope', async () => {
    const { store } = fakeStore({ rows, headSeq: 2, oldestSeq: 1 });
    const { body } = await call('/api/events/replay?since=0&limit=10', store);
    expect(body).toEqual({
      events: [
        { seq: 1, ts: rows[0].ts, type: 'mafw_event', sessionId: 'ses_a', envelope: rows[0].envelope },
        { seq: 2, ts: rows[1].ts, type: 'mafw_event', sessionId: null, envelope: rows[1].envelope },
      ],
      headSeq: 2,
      oldestSeq: 1,
      hasMore: false,
      nextSince: 2,
      reset: false,
      truncated: false,
    });
  });

  test('since 超过 headSeq → reset=true、events=[]、nextSince=headSeq（防 reset-loop）', async () => {
    const { store } = fakeStore({ rows: [], headSeq: 100, oldestSeq: 1 });
    const { body } = await call('/api/events/replay?since=200', store);
    expect(body).toMatchObject({
      events: [],
      headSeq: 100,
      oldestSeq: 1,
      hasMore: false,
      nextSince: 100,
      reset: true,
      truncated: false,
    });
    // 客户端把 nextSince 持久化成游标后不再是 since > headSeq（不会反复 reset）。
    expect(body.nextSince).toBe(body.headSeq);
  });

  test('空表 since=0 → reset=false、nextSince=0', async () => {
    const { store } = fakeStore({ rows: [], headSeq: 0, oldestSeq: 0 });
    const { body } = await call('/api/events/replay', store);
    expect(body).toMatchObject({ events: [], headSeq: 0, oldestSeq: 0, hasMore: false, nextSince: 0, reset: false, truncated: false });
  });

  test('since 早于保留窗口 → truncated=true，仍返回可读行', async () => {
    const { store } = fakeStore({ rows: rows.map((r) => ({ ...r, seq: r.seq + 4 })), headSeq: 6, oldestSeq: 5 });
    const { body } = await call('/api/events/replay?since=2&limit=10', store);
    expect(body.truncated).toBe(true);
    expect(body.reset).toBe(false);
    expect(body.events.map((e: any) => e.seq)).toEqual([5, 6]);
    expect(body.nextSince).toBe(6);
  });

  test('since + 1 === oldestSeq → truncated=false（恰好没有缺口）', async () => {
    const { store } = fakeStore({ rows: [{ ...rows[0], seq: 5 }], headSeq: 5, oldestSeq: 5 });
    const { body } = await call('/api/events/replay?since=4', store);
    expect(body.truncated).toBe(false);
  });

  test('hasMore：满页且 lastSeq < headSeq；lastSeq === headSeq 时为 false', async () => {
    const more = fakeStore({ rows, headSeq: 5, oldestSeq: 1 });
    expect((await call('/api/events/replay?limit=2', more.store)).body.hasMore).toBe(true);

    const done = fakeStore({ rows, headSeq: 2, oldestSeq: 1 });
    expect((await call('/api/events/replay?limit=2', done.store)).body.hasMore).toBe(false);
  });

  test('store 为 null → 503 event store unavailable', async () => {
    const { res, body } = await call('/api/events/replay', null);
    expect(res.statusCode).toBe(503);
    expect(body).toEqual({ error: 'event store unavailable' });
  });
});

describe('GET /api/events/replay: schema + catalog', () => {
  test('handler 真实响应通过 EventReplayResponse 校验', async () => {
    const { store } = fakeStore({ rows, headSeq: 5, oldestSeq: 1 });
    const { body } = await call('/api/events/replay?limit=2', store);
    expect([...Value.Errors(EventReplayResponse, body)]).toEqual([]);
    expect(Value.Check(EventReplayResponse, body)).toBe(true);
  });

  test('catalog 登记 event.replay（GET /api/events/replay，internal，带 response schema）', () => {
    const def = buildRouteCatalog().find((d) => d.operationId === 'event.replay');
    expect(def).toBeDefined();
    expect(def!.method).toBe('GET');
    expect(def!.path).toBe('/api/events/replay');
    expect(def!.tags).toEqual(['internal']);
    expect(def!.summary).toBe('event_log paginated recovery');
    expect(def!.response).toBe(EventReplayResponse);
  });

  test('registry 路由匹配到 event.replay（可达性本地证据）', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachEventsReplayRoute(registry, { eventStore: () => null });
    expect(registry.match('GET', '/api/events/replay')!.def.operationId).toBe('event.replay');
    expect(registry.attachedOperationIds().has('event.replay')).toBe(true);
  });
});
