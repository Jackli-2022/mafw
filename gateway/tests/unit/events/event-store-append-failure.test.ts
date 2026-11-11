/**
 * E2-5: event_log append 失败可观测（spec 2026-11-11-gateway-e2-recovery §3 E2-5）。
 *
 * 缺陷：`append()` 的 catch 静默返回 null——DB 写失败（disk full / locked /
 * 损坏）时事件日志悄悄停更，`/api/stats` 与日志都看不出来；客户端只表现为
 * 重连时永久漏帧。
 *
 * 钉住：
 *  (a) append 抛错 → 返回 null，失败计数 +1；
 *  (b) 限频日志：30s 窗口内只记一条 `[Events] append failed…`，窗口过去再记；
 *  (c) 计数是进程级累计（恢复成功后仍保留）；
 *  (d) `/api/stats` 暴露 `eventAppendFailures`（无 event store 时省略字段，
 *      既有 stats 形状不变）。
 */
import Database from 'better-sqlite3';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  EventStore,
  APPEND_FAILURE_LOG_INTERVAL_MS,
} from '../../../src/events/event-store';
import { log } from '../../../src/core/utils/logger';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachDashboardRoutes } from '../../../src/routes/dashboard';

/** db whose prepare() always throws (constructor's exec() still succeeds). */
function brokenDb(): Database {
  return {
    exec: () => {},
    prepare: () => { throw new Error('disk I/O error'); },
  } as unknown as Database;
}

const okEnv = () => ({ type: 'tick', sessionID: null });

describe('EventStore append 失败计数（E2-5 a）', () => {
  it('append 抛错：返回 null，失败计数 +1，并记录一次 error', () => {
    const error = jest.spyOn(log, 'error').mockImplementation(() => {});
    const store = new EventStore(brokenDb());
    expect(store.append(okEnv())).toBeNull();
    expect(store.appendFailures()).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[Events] append failed');
    error.mockRestore();
  });

  it('非持久事件（part.delta）不算失败（既有早退路径不变）', () => {
    const store = new EventStore(brokenDb());
    expect(store.append({ type: 'part.delta' })).toBeNull();
    expect(store.appendFailures()).toBe(0);
  });
});

describe('失败日志限频（E2-5 b）', () => {
  it('30s 窗口内只记一条，窗口过去再记', () => {
    expect(APPEND_FAILURE_LOG_INTERVAL_MS).toBe(30_000);
    const error = jest.spyOn(log, 'error').mockImplementation(() => {});
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const store = new EventStore(brokenDb());

    store.append(okEnv());
    expect(error).toHaveBeenCalledTimes(1); // 首次失败必记

    now += APPEND_FAILURE_LOG_INTERVAL_MS - 1;
    store.append(okEnv());
    expect(error).toHaveBeenCalledTimes(1); // 窗口内压掉
    expect(store.appendFailures()).toBe(2); // 但计数照常

    now += 1;
    store.append(okEnv());
    expect(error).toHaveBeenCalledTimes(2); // 新窗口
    expect(store.appendFailures()).toBe(3);

    nowSpy.mockRestore();
    error.mockRestore();
  });
});

describe('计数为进程级累计（E2-5 c）', () => {
  it('恢复成功后失败计数保留', () => {
    const error = jest.spyOn(log, 'error').mockImplementation(() => {});
    const db = new Database(':memory:');
    const realPrepare = db.prepare.bind(db);
    let broken = true;
    (db as any).prepare = (sql: string) => {
      if (broken) throw new Error('disk I/O error');
      return realPrepare(sql);
    };
    const store = new EventStore(db);
    expect(store.append(okEnv())).toBeNull();
    broken = false;
    expect(typeof store.append(okEnv())).toBe('number');
    expect(store.appendFailures()).toBe(1);
    error.mockRestore();
  });
});

// ── /api/stats 接线 ──────────────────────────────────────────────────────────
function fakeRes(): { res: ServerResponse; body: string } {
  const out = { body: '' };
  out.res = {
    writeHead: () => {},
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get body() { return out.body; } } as any;
}

function statsBody(over: Record<string, unknown> = {}): any {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDashboardRoutes(registry, {
    activeGoals: () => new Map<string, any>(),
    registeredProjectsSize: () => 0,
    sseClientsSize: () => 0,
    serveRunning: () => false,
    trajectoryStore: () => null,
    memoryService: () => null,
    ...over,
  } as any);
  const match = registry.match('GET', '/api/stats');
  const r = fakeRes();
  match!.def.handler!(fakeReq(), r.res, match.params);
  return { body: JSON.parse(r.body) };
}

function fakeReq(): IncomingMessage {
  return { method: 'GET', url: '/api/stats', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

describe('/api/stats 暴露 eventAppendFailures（E2-5 d）', () => {
  it('有 event store：payload 含实时计数', () => {
    const { body } = statsBody({ eventAppendFailures: () => 3 });
    expect(body.eventAppendFailures).toBe(3);
    expect(body.sseClients).toBe(0);
  });

  it('无 event store：字段省略，既有 stats 形状不变', () => {
    const { body } = statsBody({ eventAppendFailures: () => null });
    expect('eventAppendFailures' in body).toBe(false);
  });
});
