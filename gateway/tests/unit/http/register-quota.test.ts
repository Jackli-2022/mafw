/**
 * E4-7 `/register` 项目配额（spec §4.7）。
 *
 * 项目数超限时 transport 必须回 429 机器码信封（而不是把它埋进既有
 * `400 Invalid JSON` 兜底），客户端才能区分「请求坏了」与「容量满了」。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { QuotaExceededError } from '../../../src/resources/quotas';

interface Recorded {
  status?: number;
  body: string;
  done: Promise<void>;
}

function fakeRes(): { res: ServerResponse; rec: Recorded } {
  let markDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });
  const rec: Recorded = { body: '', done };
  const res = {
    headersSent: false,
    setHeader() {
      return this;
    },
    writeHead(status: number) {
      rec.status = status;
      this.headersSent = true;
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) rec.body += String(chunk);
      this.headersSent = true;
      markDone();
      return this;
    },
    write(chunk: unknown) {
      rec.body += String(chunk);
      return true;
    },
  } as unknown as ServerResponse;
  return { res, rec };
}

function fakeReq(body: unknown, raw = false): IncomingMessage {
  const listeners: Record<string, Array<(chunk?: unknown) => void>> = {};
  const req: any = {
    method: 'POST',
    url: '/register',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on(ev: string, fn: (chunk?: unknown) => void) {
      (listeners[ev] = listeners[ev] ?? []).push(fn);
      return req;
    },
    pipe() {
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(raw ? body : JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function makeDeps(over: Partial<TransportDeps['register']> = {}): TransportDeps {
  return {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => 'tok',
    dispatchAuthorized: async () => false,
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: {} }),
    register: {
      parseIntent: (data: any) => ({ projectDir: data.projectDir, mafwDir: data.mafwDir, setCurrent: false }),
      isUserDataDir: () => false,
      isSelectableProject: () => true,
      registeredProject: () => undefined,
      registerProject: () => undefined,
      setCurrentProject: () => undefined,
      persistRegistry: async () => undefined,
      broadcastProjectRegistered: () => undefined,
      hasRuntime: () => false,
      ensureManagerSession: async () => 'sid',
      ...over,
    },
    control: {
      patchState: async () => undefined,
      destroyAllSessions: async () => undefined,
      getActiveGoal: () => undefined,
      registeredProjects: () => new Map<string, { mafwDir: string }>().entries(),
      getGatewayDb: () => ({}) as never,
      archiveGoal: async () => undefined,
    },
    health: {
      serveRunning: () => false,
      registeredProjectDirs: () => [],
      activeGoalIds: () => [],
      mediaConfigured: () => false,
      releaseFields: () => ({}),
    },
    proxyTarget: () => 'http://127.0.0.1:9',
  };
}

const BODY = { projectDir: '/proj/one', mafwDir: '/proj/one/.mafw' };

describe('POST /register: project quota', () => {
  it('maps QuotaExceededError to 429 with resource/limit/current', async () => {
    const deps = makeDeps({
      registerProject: () => {
        throw new QuotaExceededError('projects', 128, 128);
      },
    });
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq(BODY), res);
    await rec.done;

    expect(rec.status).toBe(429);
    const body = JSON.parse(rec.body);
    expect(body.code).toBe('quota_exceeded');
    expect(body.resource).toBe('projects');
    expect(body.limit).toBe(128);
    expect(body.current).toBe(128);
    expect(typeof body.error).toBe('string');
  });

  it('keeps the success shape when under quota', async () => {
    const registerProject = jest.fn();
    const deps = makeDeps({ registerProject });
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq(BODY), res);
    await rec.done;

    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ status: 'ok', registered: BODY.projectDir });
    expect(registerProject).toHaveBeenCalledTimes(1);
  });

  it('still answers 400 Invalid JSON for unparseable bodies', async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq('{not json', true), res);
    await rec.done;
    expect(rec.status).toBe(400);
    expect(JSON.parse(rec.body)).toEqual({ error: 'Invalid JSON' });
  });
});
