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
  // handleValidate schedules onGoalCreated via setImmediate; stub it so the
  // real langgraph plan never runs inside the test process.
  (scheduler as any).onGoalCreated = async () => {};
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
    nextAction: 'GRAPH_INVOKED',
    artifacts: {},
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

// ── POST /api/work/{goalId}/validate ──

test('handleValidate creates state file and returns GRAPH_INVOKED', async () => {
  const scheduler = createScheduler();
  const result = await (scheduler as any).handleValidate('001-auth');

  expect(result).toEqual({
    success: true,
    goalId: '001-auth',
    nextAction: 'GRAPH_INVOKED'
  });

  const statePath = path.join(mafwDir, 'state', '001-auth.json');
  expect(fs.existsSync(statePath)).toBe(true);

  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  expect(state.goalId).toBe('001-auth');
  expect(state.phase).toBe('PLANNING');
  expect(state.nextAction).toBe('GRAPH_INVOKED');
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

  expect(result.nextAction).toBe('GRAPH_INVOKED');
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
// handleComplete is a scheduling signal: it returns SCHEDULED and lets the
// event-driven state machine (onEvent) drive phase transitions.

test('handleComplete returns SCHEDULED and schedules onEvent', async () => {
  writeState('001-auth', { phase: 'PLANNING', nextAction: 'WAIT_PHASE_COMPLETE' });
  const scheduler = createScheduler();
  const onEventSpy = jest.spyOn(scheduler as any, 'onEvent').mockImplementation(() => {});
  const result = await (scheduler as any).handleComplete('001-auth');
  await new Promise(r => setTimeout(r, 10)); // setImmediate dispatch
  expect(result).toEqual({ success: true, nextAction: 'SCHEDULED' });
  expect(onEventSpy).toHaveBeenCalledWith('001-auth');
  onEventSpy.mockRestore();
});

test('handleComplete accepts optional score without side effects', async () => {
  writeState('001-auth', { phase: 'REVIEWING', nextAction: 'CHECK_VERDICT' });
  const scheduler = createScheduler();
  jest.spyOn(scheduler as any, 'onEvent').mockImplementation(() => {});
  const result = await (scheduler as any).handleComplete('001-auth', { score: 92 });
  expect(result).toEqual({ success: true, nextAction: 'SCHEDULED' });
});

test('handleComplete does not modify the state file synchronously', async () => {
  writeState('001-auth', { phase: 'PLANNING', nextAction: 'WAIT_PHASE_COMPLETE' });
  const scheduler = createScheduler();
  jest.spyOn(scheduler as any, 'onEvent').mockImplementation(() => {});
  await (scheduler as any).handleComplete('001-auth');
  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('WAIT_PHASE_COMPLETE');
});
