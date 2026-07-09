import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MafwScheduler } = require('../../../gateway/dist/index');
type MafwSchedulerType = InstanceType<typeof MafwScheduler>;

let tmpDir: string;
let projectDir: string;
let mafwDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-mcp-'));
  projectDir = path.join(tmpDir, 'project');
  mafwDir = path.join(projectDir, '.mafw');
  fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createScheduler(): MafwSchedulerType {
  const scheduler = new MafwScheduler(tmpDir);
  (scheduler as any).registeredProjects.set(projectDir, {
    projectDir,
    mafwDir,
    registeredAt: new Date().toISOString()
  });
  (scheduler as any).createPhaseSession = async () => {};
  return scheduler;
}

function writeState(goalId: string, overrides: Record<string, any> = {}): string {
  const state = {
    version: '2',
    goalId,
    loop: 1,
    phase: 'PLANNING',
    lastPhase: null,
    currentWave: 0,
    totalWaves: null,
    sessions: {},
    nextAction: 'CREATE_PLAN_SESSION',
    artifacts: {},
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

// ── POST /api/work/{goalId}/validate ──

test('handleValidate creates state file and returns CREATE_PLAN_SESSION', async () => {
  const scheduler = createScheduler();
  const result = await (scheduler as any).handleValidate('001-auth');

  expect(result).toEqual({
    success: true,
    goalId: '001-auth',
    nextAction: 'CREATE_PLAN_SESSION'
  });

  const statePath = path.join(mafwDir, 'state', '001-auth.json');
  expect(fs.existsSync(statePath)).toBe(true);

  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  expect(state.goalId).toBe('001-auth');
  expect(state.phase).toBe('PLANNING');
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
  expect(state.loop).toBe(1);

  expect((scheduler as any).activeGoals.has('001-auth')).toBe(true);
});

test('handleValidate returns error if goal already exists', async () => {
  writeState('001-auth');
  const scheduler = createScheduler();

  await expect(
    (scheduler as any).handleValidate('001-auth')
  ).rejects.toThrow('Goal already exists');
});

test('handleValidate returns error if no registered projects', async () => {
  const scheduler = new MafwScheduler(tmpDir);
  (scheduler as any).createPhaseSession = async () => {};

  await expect(
    (scheduler as any).handleValidate('001-auth')
  ).rejects.toThrow('No registered projects');
});

test('handleValidate uses specified projectDir from body', async () => {
  const scheduler = createScheduler();
  const result = await (scheduler as any).handleValidate('001-auth', { projectDir });

  expect(result.nextAction).toBe('CREATE_PLAN_SESSION');
  const statePath = path.join(mafwDir, 'state', '001-auth.json');
  expect(fs.existsSync(statePath)).toBe(true);
});

test('handleValidate writes atomically (no .tmp file remains)', async () => {
  const scheduler = createScheduler();
  await (scheduler as any).handleValidate('001-auth');

  const tmpPath = path.join(mafwDir, 'state', '001-auth.json.tmp');
  expect(fs.existsSync(tmpPath)).toBe(false);
});

// ── POST /api/work/{goalId}/complete ──

test('handleComplete transitions PLANNING �?EXECUTING', async () => {
  writeState('001-auth', { phase: 'PLANNING', nextAction: 'WAIT_PHASE_COMPLETE' });
  const scheduler = createScheduler();

  const result = await (scheduler as any).handleComplete('001-auth');

  expect(result).toEqual({
    success: true,
    nextAction: 'CREATE_EXECUTE_SESSION',
    phase: 'EXECUTING'
  });

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('EXECUTING');
  expect(state.nextAction).toBe('CREATE_EXECUTE_SESSION');
});

test('handleComplete transitions EXECUTING �?REVIEWING', async () => {
  writeState('001-auth', { phase: 'EXECUTING', nextAction: 'WAIT_PHASE_COMPLETE' });
  const scheduler = createScheduler();

  const result = await (scheduler as any).handleComplete('001-auth');

  expect(result).toEqual({
    success: true,
    nextAction: 'CREATE_REVIEW_SESSION',
    phase: 'REVIEWING'
  });

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('REVIEWING');
  expect(state.nextAction).toBe('CREATE_REVIEW_SESSION');
});

test('handleComplete REVIEWING with score >= 85 archives the goal', async () => {
  writeState('001-auth', { phase: 'REVIEWING', nextAction: 'CHECK_VERDICT' });
  const scheduler = createScheduler();
  (scheduler as any).loadArchiveModule = async () => ({
    archiveWorktree: async () => {}
  });

  const result = await (scheduler as any).handleComplete('001-auth', { score: 92 });

  expect(result).toEqual({
    success: true,
    nextAction: 'COMPLETED',
    phase: 'ARCHIVED'
  });

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('ARCHIVED');
  expect(state.nextAction).toBe('COMPLETED');
});

test('handleComplete REVIEWING with score >= 60 retries EXECUTING', async () => {
  writeState('001-auth', { phase: 'REVIEWING', nextAction: 'CHECK_VERDICT', loop: 1 });
  const scheduler = createScheduler();

  const result = await (scheduler as any).handleComplete('001-auth', { score: 72 });

  expect(result).toEqual({
    success: true,
    nextAction: 'CREATE_EXECUTE_SESSION',
    phase: 'EXECUTING'
  });

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('EXECUTING');
  expect(state.nextAction).toBe('CREATE_EXECUTE_SESSION');
  expect(state.loop).toBe(1);
});

test('handleComplete REVIEWING with score < 60 starts new loop (PLANNING)', async () => {
  writeState('001-auth', { phase: 'REVIEWING', nextAction: 'CHECK_VERDICT', loop: 1 });
  const scheduler = createScheduler();

  const result = await (scheduler as any).handleComplete('001-auth', { score: 45 });

  expect(result).toEqual({
    success: true,
    nextAction: 'CREATE_PLAN_SESSION',
    phase: 'PLANNING'
  });

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('PLANNING');
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
  expect(state.loop).toBe(2);
});

test('handleComplete REVIEWING with no score defaults to new loop (PLANNING)', async () => {
  writeState('001-auth', { phase: 'REVIEWING', nextAction: 'CHECK_VERDICT', loop: 1 });
  const scheduler = createScheduler();

  const result = await (scheduler as any).handleComplete('001-auth', {});

  expect(result.phase).toBe('PLANNING');
  expect(result.nextAction).toBe('CREATE_PLAN_SESSION');
});

test('handleComplete throws for unknown phase', async () => {
  writeState('001-auth', { phase: 'ARCHIVED', nextAction: 'COMPLETED' });
  const scheduler = createScheduler();

  await expect(
    (scheduler as any).handleComplete('001-auth')
  ).rejects.toThrow('Unknown phase: ARCHIVED');
});

test('handleComplete throws for missing state file', async () => {
  const scheduler = createScheduler();
  await expect(
    (scheduler as any).handleComplete('nonexistent')
  ).rejects.toThrow('State not found for goal nonexistent');
});

test('handleComplete writes atomically (no .tmp file remains)', async () => {
  writeState('001-auth', { phase: 'PLANNING' });
  const scheduler = createScheduler();

  await (scheduler as any).handleComplete('001-auth');

  const tmpPath = path.join(mafwDir, 'state', '001-auth.json.tmp');
  expect(fs.existsSync(tmpPath)).toBe(false);
});
