jest.mock('../../../gateway/src/mcp/sse-transport', () => ({
  McpSSEEndpoint: class {},
}));
jest.mock('../../../gateway/src/mcp/tool-registry', () => ({
  createToolRegistry: jest.fn(() => ({ definitions: [], handlers: {} })),
}));
jest.mock('../../../gateway/src/skills/manager-identity', () => ({
  MANAGER_IDENTITY_SYSTEM_PROMPT: '[MAFW MANAGER IDENTITY] test prompt',
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';

const { MafwScheduler } = require('../../../gateway/src/index');

describe('MafwScheduler.ensureManagerSession', () => {
  let tmpDir: string;
  let projectDir: string;
  let mafwDir: string;
  let scheduler: any;
  let mockClient: any;
  let db: GatewayDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-bootstrap-'));
    projectDir = path.join(tmpDir, 'project');
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ id: 'mock-session-123' }),
        promptAsync: jest.fn().mockResolvedValue(undefined),
      },
    };

    db = new GatewayDatabase(':memory:');
    scheduler = new MafwScheduler(projectDir);
    scheduler.mafwDir = mafwDir;
    scheduler.opencodeClient = mockClient;
    scheduler.sdkSession = { registerExternal: jest.fn().mockResolvedValue(undefined) };
    scheduler.gatewayDbInstance = db; // inject in-memory DB (no real data dir writes)
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stores the created session in the gateway DB', async () => {
    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('mock-session-123');
    const stored = db.kvGet<{ sessionId: string; createdAt: string }>('manager-session', projectDir);
    expect(stored).toEqual({ sessionId: 'mock-session-123', createdAt: expect.any(String) });
  });

  it('returns existing session when one is stored in the DB', async () => {
    db.kvSet('manager-session', projectDir, { sessionId: 'existing-session', createdAt: '2026-01-01' });

    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('existing-session');
    expect(mockClient.session.create).not.toHaveBeenCalled();
  });

  it('creates session with correct metadata structure', async () => {
    await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(mockClient.session.create).toHaveBeenCalledTimes(1);
    const createCall = mockClient.session.create.mock.calls[0][0];
    expect(createCall.query?.directory ?? createCall.directory).toBe(projectDir);
    // metadata is attached via the local registry (sdkSession.registerExternal)
    const registerCall = (scheduler.sdkSession as any).registerExternal.mock.calls[0];
    expect(registerCall[0]).toBe('mock-session-123');
    expect(registerCall[1]).toBe(projectDir);
    expect(registerCall[2]).toEqual({
      mafw: {
        role: 'manager',
        pinned: true,
        exemptFromTrim: true,
        exemptFromEvict: true,
        exemptFromArchive: true,
      },
    });
  });

  it('injects identity system prompt after session creation', async () => {
    await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);
    const promptCall = mockClient.session.promptAsync.mock.calls[0][0];
    expect(promptCall.path?.id ?? promptCall.sessionID).toBe('mock-session-123');
    const text = promptCall.body?.parts?.[0]?.text ?? promptCall.message;
    expect(text).toContain('[MAFW MANAGER IDENTITY]');
  });

  it('updates the gateway DB after create', async () => {
    await scheduler.ensureManagerSession(projectDir, mafwDir);

    const stored = db.kvGet<{ sessionId: string; createdAt?: string }>('manager-session', projectDir);
    expect(stored?.sessionId).toBe('mock-session-123');
    expect(stored?.createdAt).toBeDefined();
  });

  it('recovers an existing session from the gateway DB', async () => {
    const createdAt = new Date().toISOString();
    db.kvSet('manager-session', projectDir, { sessionId: 'existing-session', createdAt });

    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('existing-session');
    expect(mockClient.session.create).not.toHaveBeenCalled();
  });

  it('creates a new session when nothing is stored', async () => {
    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('mock-session-123');
    expect(mockClient.session.create).toHaveBeenCalledTimes(1);
    const stored = db.kvGet<{ sessionId: string }>('manager-session', projectDir);
    expect(stored?.sessionId).toBe('mock-session-123');
  });

  it('deduplicates concurrent calls for the same project (single creation)', async () => {
    // both triggers fire before either resolves
    const p1 = scheduler.ensureManagerSession(projectDir, mafwDir);
    const p2 = scheduler.ensureManagerSession(projectDir, mafwDir);

    const [id1, id2] = await Promise.all([p1, p2]);
    expect(id1).toBe('mock-session-123');
    expect(id2).toBe('mock-session-123');
    expect(mockClient.session.create).toHaveBeenCalledTimes(1);
    expect(mockClient.session.promptAsync).toHaveBeenCalledTimes(1);
  });

  it('distinct projects create distinct sessions', async () => {
    const otherDir = path.join(tmpDir, 'other');
    await scheduler.ensureManagerSession(projectDir, mafwDir);
    await scheduler.ensureManagerSession(otherDir, mafwDir);
    expect(mockClient.session.create).toHaveBeenCalledTimes(2);
  });
});
