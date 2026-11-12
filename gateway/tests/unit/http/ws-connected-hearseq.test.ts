/**
 * E2-4: `/api/ws` 降级为 live-only 通道——connected greeting 带 headSeq。
 *
 * WS 不回放（mobile 重连仍走全量）；headSeq 让客户端知道"实时流从哪一 seq 接上"，
 * 重连恢复必须由 SSE 游标或 REST 快照兜底（docs/architecture/gateway.md）。
 *
 * 钉住：
 *  (a) connected 帧的 headSeq 来自 deps getter（连接时实时取）；
 *  (b) 既有字段 type/timestamp/vocab 保持不变；
 *  (c) 无 event store（getter 返回 null）时 headSeq = null，帧仍可被
 *      "只读已知字段"的老解析器消费（未知字段容忍）。
 */
import * as http from 'http';
import { createWsHub, type WsHubDeps } from '../../../src/http/ws-upgrade';

const TOKEN = 'sekret';

interface FakeSocket {
  remoteAddress: string;
  write(chunk: string): boolean;
  destroy(): void;
}

function fakeSocket(): FakeSocket {
  return { remoteAddress: '127.0.0.1', write: () => true, destroy: () => {} };
}

function fakeReq(url: string): http.IncomingMessage {
  return {
    url,
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as http.IncomingMessage;
}

const hubs: Array<ReturnType<typeof createWsHub>> = [];

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.dispose();
  jest.restoreAllMocks();
});

function setup(over: Partial<WsHubDeps> = {}) {
  const wsClients = new Set<unknown>();
  const deps: WsHubDeps = {
    wsClients: wsClients as never,
    apiToken: () => TOKEN,
    pushGateway: () => undefined,
    handleWsMessage: jest.fn(),
    getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
    getTerminalService: jest.fn(() => ({ bridge: jest.fn() })),
    pluginWebDeps: jest.fn(() => ({}) as never),
    ...over,
  };
  const server = http.createServer();
  const hub = createWsHub(server, deps);
  hubs.push(hub);
  const sent: string[] = [];
  const ws = {
    deviceId: undefined as string | undefined,
    send: (frame: string) => { sent.push(frame); },
    on: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
    close: jest.fn(),
  };
  jest.spyOn(hub.wss, 'handleUpgrade').mockImplementation(((_req, _socket, _head, cb: any) => {
    cb(ws as never);
  }) as never);
  server.emit('upgrade', fakeReq('/api/ws'), fakeSocket() as never, Buffer.alloc(0));
  const greetings = sent
    .map((raw) => { try { return JSON.parse(raw); } catch { return null; } })
    .filter((f) => f?.type === 'connected');
  return { hub, server, ws, greetings };
}

describe('createWsHub connected greeting（E2-4）', () => {
  it('connected 帧携带 deps 提供的 headSeq，既有字段不变', () => {
    const { greetings } = setup({ headSeq: () => 42 });
    expect(greetings).toHaveLength(1);
    const greeting = greetings[0];
    expect(greeting.headSeq).toBe(42);
    expect(greeting.type).toBe('connected');
    expect(greeting.vocab).toBe('v2');
    expect(typeof greeting.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(greeting.timestamp))).toBe(false);
  });

  it('headSeq 在连接时实时读取（live getter）', () => {
    let head = 1;
    const { greetings } = setup({ headSeq: () => head });
    expect(greetings[0].headSeq).toBe(1);
    head = 9;
    const s = setup({ headSeq: () => head });
    expect(s.greetings[0].headSeq).toBe(9);
  });

  it('无 event store（headSeq → null）：字段为 null，未知字段容忍的老解析器仍可用', () => {
    const { greetings } = setup({ headSeq: () => null });
    const greeting = greetings[0];
    expect(greeting.headSeq).toBeNull();
    // 老客户端只读已知字段：JSON.parse 后按名字取，不受新增字段影响。
    const legacyView = { type: greeting.type, timestamp: greeting.timestamp, vocab: greeting.vocab };
    expect(legacyView).toEqual({ type: 'connected', timestamp: greeting.timestamp, vocab: 'v2' });
  });
});

describe('createWsHub connected greeting（E5b-3 instanceId epoch）', () => {
  it('connected 帧同时携带 headSeq 与 instanceId', () => {
    const { greetings } = setup({
      headSeq: () => 42,
      instanceId: () => 'inst-abc',
    });

    expect(greetings).toHaveLength(1);
    expect(greetings[0].headSeq).toBe(42);
    expect(greetings[0].instanceId).toBe('inst-abc');
    expect(greetings[0].type).toBe('connected');
  });

  it('instanceId 在连接时实时读取（live getter）', () => {
    let id = 'inst-1';
    const { greetings } = setup({ instanceId: () => id });

    expect(greetings[0].instanceId).toBe('inst-1');
    id = 'inst-2';
    expect(setup({ instanceId: () => id }).greetings[0].instanceId).toBe('inst-2');
  });

  it('deps 未提供 instanceId 时为 null（字段仍在，additive）', () => {
    const { greetings } = setup({ headSeq: () => 7 });

    expect(greetings[0].instanceId).toBeNull();
    expect(greetings[0].headSeq).toBe(7);
  });

  it('getter 返回 null 时字段为 null（无 release metadata）', () => {
    const { greetings } = setup({ headSeq: () => 7, instanceId: () => null });

    expect(greetings[0].instanceId).toBeNull();
  });

  it('鉴权不回退：非 loopback 且无 token 的 /api/ws 升级仍 401，不写 greeting', () => {
    const wsClients = new Set<unknown>();
    const server = http.createServer();
    const hub = createWsHub(server, {
      wsClients: wsClients as never,
      apiToken: () => TOKEN,
      pushGateway: () => undefined,
      handleWsMessage: jest.fn(),
      getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
      getTerminalService: jest.fn(() => ({ bridge: jest.fn() })),
      pluginWebDeps: jest.fn(() => ({}) as never),
      headSeq: () => 1,
      instanceId: () => 'inst-abc',
    });
    hubs.push(hub);
    const upgrade = jest.spyOn(hub.wss, 'handleUpgrade');
    const written: string[] = [];
    const socket = {
      remoteAddress: '10.0.0.9',
      write: (chunk: string) => { written.push(chunk); return true; },
      destroy: jest.fn(),
    };
    const req = {
      url: '/api/ws',
      headers: { host: '10.0.0.1:3000' },
      socket: { remoteAddress: '10.0.0.9' },
    } as unknown as http.IncomingMessage;

    server.emit('upgrade', req, socket as never, Buffer.alloc(0));

    expect(upgrade).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
    expect(written.join('')).toContain('401');
    expect(written.join('')).not.toContain('instanceId');
    expect(wsClients.size).toBe(0);
  });
});
