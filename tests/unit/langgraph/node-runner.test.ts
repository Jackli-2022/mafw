import { createAgentNode, AgentServices } from '../../../src/langchain/node-runner';
import { LoopStateType } from '../../../src/langgraph/loop-state';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

jest.mock('@langchain/langgraph', () => ({
  interrupt: jest.fn(),
}));

function makeState(overrides: Partial<LoopStateType> = {}): LoopStateType {
  return {
    goalId: 'test-goal',
    projectDir: '/tmp/test',
    mafwDir: '/tmp/test/.opencode/mafw',
    round: 1,
    maxRounds: 3,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
    phase: null,
    ...overrides,
  };
}

function makeServices(): jest.Mocked<AgentServices> {
  return {
    createSession: jest.fn().mockResolvedValue('session-1'),
    sendPrompt: jest.fn().mockResolvedValue(undefined),
    destroySession: jest.fn().mockResolvedValue(undefined),
    syncToFile: jest.fn(),
  };
}

describe('planNode', () => {
  let tmpDir: string;
  let mafwDir: string;
  let state: LoopStateType;
  let services: jest.Mocked<AgentServices>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrt-plan-'));
    mafwDir = path.join(tmpDir, '.opencode', 'mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    state = makeState({ projectDir: tmpDir, mafwDir });
    services = makeServices();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ERROR when waves.json missing', async () => {
    const node = createAgentNode('plan');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBe('ERROR');
    expect(result.lastError).toContain('not found');
  });

  it('returns wavePlanPath when waves.json exists and valid', async () => {
    const wavesPath = path.join(mafwDir, 'waves.json');
    fs.writeFileSync(wavesPath, '{"waves":[]}', 'utf-8');
    const node = createAgentNode('plan');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBeUndefined();
    expect(result.wavePlanPath).toBe(wavesPath);
    expect(result.round).toBe(1);
  });
});

describe('executeNode', () => {
  let tmpDir: string;
  let mafwDir: string;
  let state: LoopStateType;
  let services: jest.Mocked<AgentServices>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrt-exec-'));
    mafwDir = path.join(tmpDir, '.opencode', 'mafw');
    fs.mkdirSync(path.join(mafwDir, 'receipts', 'test-goal'), { recursive: true });
    state = makeState({ projectDir: tmpDir, mafwDir });
    services = makeServices();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ERROR when receipt missing', async () => {
    const node = createAgentNode('execute');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBe('ERROR');
    expect(result.lastError).toContain('not found');
  });

  it('returns receiptPath when receipt exists', async () => {
    const receiptPath = path.join(mafwDir, 'receipts', 'test-goal', 'loop-receipt.json');
    fs.writeFileSync(receiptPath, '{"status":"done"}', 'utf-8');
    const node = createAgentNode('execute');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBeUndefined();
    expect(result.receiptPath).toBe(receiptPath);
  });
});

describe('reviewNode', () => {
  let tmpDir: string;
  let mafwDir: string;
  let state: LoopStateType;
  let services: jest.Mocked<AgentServices>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrt-rev-'));
    mafwDir = path.join(tmpDir, '.opencode', 'mafw');
    fs.mkdirSync(path.join(mafwDir, 'reviews'), { recursive: true });
    state = makeState({ projectDir: tmpDir, mafwDir });
    services = makeServices();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ERROR when review report missing', async () => {
    const node = createAgentNode('review');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBe('ERROR');
    expect(result.lastError).toContain('not found');
  });

  it('returns PASS verdict when review says pass', async () => {
    const reviewPath = path.join(mafwDir, 'reviews', 'test-goal-loop1.md');
    fs.writeFileSync(reviewPath, '{"verdict":"PASS","reason":"Great job!"}', 'utf-8');
    const node = createAgentNode('review');
    const result = await node(state, services);
    expect(result.reviewVerdict).toBe('PASS');
    expect(result.reviewFeedback).toContain('Great job!');
  });
});
