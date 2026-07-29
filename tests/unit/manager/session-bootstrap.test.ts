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

const { MafwScheduler } = require('../../../gateway/src/index');

describe('MafwScheduler.ensureManagerSession', () => {
  let tmpDir: string;
  let projectDir: string;
  let mafwDir: string;
  let scheduler: any;
  let mockClient: any;

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

    scheduler = new MafwScheduler(projectDir);
    scheduler.mafwDir = mafwDir;
    scheduler.opencodeClient = mockClient;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates session file when none exists', async () => {
    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('mock-session-123');

    const managerFile = path.join(mafwDir, 'manager-session.json');
    expect(fs.existsSync(managerFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(managerFile, 'utf-8'));
    expect(content.sessionId).toBe('mock-session-123');
    expect(content.createdAt).toBeDefined();
  });

  it('returns existing session when file already exists', async () => {
    const managerFile = path.join(mafwDir, 'manager-session.json');
    const createdAt = new Date().toISOString();
    fs.writeFileSync(managerFile, JSON.stringify({ sessionId: 'existing-session', createdAt }), 'utf-8');

    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('existing-session');
    expect(mockClient.session.create).not.toHaveBeenCalled();
  });

  it('creates session with correct metadata structure', async () => {
    await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(mockClient.session.create).toHaveBeenCalledTimes(1);
    const createCall = mockClient.session.create.mock.calls[0][0];
    expect(createCall.directory).toBe(projectDir);
    expect(createCall.metadata).toEqual({
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
    expect(promptCall.sessionID).toBe('mock-session-123');
    expect(promptCall.message).toContain('[MAFW MANAGER IDENTITY]');
  });

  it('updates managerSessionInfo after create', async () => {
    await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(scheduler.managerSessionInfo).toBeDefined();
    expect(scheduler.managerSessionInfo.sessionId).toBe('mock-session-123');
    expect(scheduler.managerSessionInfo.projectDir).toBe(projectDir);
    expect(scheduler.managerSessionInfo.createdAt).toBeDefined();
  });

  it('recovers managerSessionInfo from existing file', async () => {
    const createdAt = new Date().toISOString();
    const managerFile = path.join(mafwDir, 'manager-session.json');
    fs.writeFileSync(managerFile, JSON.stringify({ sessionId: 'existing-session', createdAt }), 'utf-8');

    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('existing-session');
    expect(scheduler.managerSessionInfo).toEqual({
      sessionId: 'existing-session',
      projectDir,
      createdAt,
    });
  });

  it('recreates session if existing file is corrupt', async () => {
    const managerFile = path.join(mafwDir, 'manager-session.json');
    fs.writeFileSync(managerFile, 'not valid json', 'utf-8');

    const sessionId = await scheduler.ensureManagerSession(projectDir, mafwDir);

    expect(sessionId).toBe('mock-session-123');
    expect(mockClient.session.create).toHaveBeenCalledTimes(1);
    const content = JSON.parse(fs.readFileSync(managerFile, 'utf-8'));
    expect(content.sessionId).toBe('mock-session-123');
  });
});
