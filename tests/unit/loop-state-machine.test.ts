import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoopStateMachineImpl, LoopState, WaveState } from '../../src/engine/loop-state-machine';
import { initState } from '../../src/utils/state';

let tmpDir: string;
const goalId = 'test-goal';

function writeWaves(waves: any[]): void {
  const wavesDir = path.join(tmpDir, '.opencode', 'mafw');
  if (!fs.existsSync(wavesDir)) fs.mkdirSync(wavesDir, { recursive: true });
  fs.writeFileSync(
    path.join(wavesDir, 'waves.json'),
    JSON.stringify({ waves }, null, 2)
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-loop-'));
  fs.mkdirSync(path.join(tmpDir, '.opencode', 'mafw', 'state'), { recursive: true });
  initState(goalId, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createMachine(loopNum: number = 1): LoopStateMachineImpl {
  return new LoopStateMachineImpl(goalId, loopNum, tmpDir);
}

test('initial state is IDLE', () => {
  const m = createMachine();
  expect(m.state).toBe(LoopState.IDLE);
});

test('IDLE -> PLANNING on goal.create', async () => {
  const m = createMachine();
  const result = await m.handleEvent('goal.create');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.PLANNING);
});

test('PLANNING -> WAVE_READY on plan.complete', async () => {
  writeWaves([{ id: 'wave-1', tasks: [] }]);
  const m = createMachine();
  await m.handleEvent('goal.create');
  const result = await m.handleEvent('plan.complete');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.EXECUTING); // loadWaves auto-triggers deps.satisfied
});

test('invalid transition returns false', async () => {
  const m = createMachine();
  const result = await m.handleEvent('wave.complete');
  expect(result).toBe(false);
  expect(m.state).toBe(LoopState.IDLE);
});

test('canStartWave returns correct boolean based on dependencies', () => {
  const m = createMachine();
  m.state = LoopState.WAVE_READY;
  m.waves = [
    { waveNum: 1, state: WaveState.COMPLETED, dependencies: [], retryCount: 0, maxRetries: 3 },
    { waveNum: 2, state: WaveState.PENDING, dependencies: [1], retryCount: 0, maxRetries: 3 },
    { waveNum: 3, state: WaveState.PENDING, dependencies: [2], retryCount: 0, maxRetries: 3 }
  ];

  expect(m.canStartWave(1)).toBe(true);
  expect(m.canStartWave(2)).toBe(true);
  expect(m.canStartWave(3)).toBe(false);

  m.waves[1].state = WaveState.COMPLETED;
  expect(m.canStartWave(3)).toBe(true);
});

test('getState returns expected shape', () => {
  const m = createMachine();
  const state = m.getState();
  expect(state).toHaveProperty('goalId', goalId);
  expect(state).toHaveProperty('loopNum', 1);
  expect(state).toHaveProperty('state', LoopState.IDLE);
  expect(state).toHaveProperty('waves');
  expect(state).toHaveProperty('currentWave', 0);
  expect(state).toHaveProperty('phase', '');
  expect(state).toHaveProperty('verdict', null);
  expect(state).toHaveProperty('transitions', expect.any(Number));
});

test('canStartWave returns false for unknown wave', () => {
  const m = createMachine();
  expect(m.canStartWave(99)).toBe(false);
});

test('full flow IDLE -> PLANNING -> WAVE_READY -> EXECUTING -> WAVE_CHECK -> REVIEWING -> VERDICT -> FAIL', async () => {
  writeWaves([{ id: 'wave-1', tasks: ['t1'] }]);
  const m = createMachine();

  expect(await m.handleEvent('goal.create')).toBe(true);
  expect(m.state).toBe(LoopState.PLANNING);

  expect(await m.handleEvent('plan.complete')).toBe(true);
  expect(m.state).toBe(LoopState.EXECUTING);
  expect(m.currentWave).toBe(1);

  // Complete the wave -> WAVE_CHECK (intermediate state per spec)
  expect(await m.handleEvent('wave.complete')).toBe(true);
  expect(m.state).toBe(LoopState.WAVE_CHECK);
  expect(m.waves[0].state).toBe(WaveState.COMPLETED);

  // No more waves -> REVIEWING
  expect(await m.handleEvent('noMoreWaves')).toBe(true);
  expect(m.state).toBe(LoopState.REVIEWING);

  // Review.complete auto-routes: REVIEWING -> VERDICT -> FAIL (no review file)
  expect(await m.handleEvent('review.complete')).toBe(true);
  expect(m.state).toBe(LoopState.FAIL);
  expect(m.verdict).toBe('FAIL');
});

test('full flow PASS', async () => {
  writeWaves([{ id: 'wave-1', tasks: ['t1'] }]);
  const m = createMachine();

  await m.handleEvent('goal.create');
  await m.handleEvent('plan.complete');
  await m.handleEvent('wave.complete');

  // Move through WAVE_CHECK -> REVIEWING
  await m.handleEvent('noMoreWaves');

  // Write a review file with PASS verdict
  const reviewsDir = path.join(tmpDir, '.opencode', 'mafw', 'reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewsDir, `${goalId}-loop1.md`),
    '# Review\n\nVerdict: PASS\n\nAll good.'
  );

  // review.complete auto-routes: REVIEWING -> VERDICT -> PASS
  await m.handleEvent('review.complete');
  expect(m.state).toBe(LoopState.PASS);
  expect(m.verdict).toBe('PASS');
});

test('EXECUTING -> WAVE_RETRY on wave.fail when retryCount < maxRetries', async () => {
  writeWaves([{ id: 'wave-1', tasks: ['t1'] }]);
  const m = createMachine();
  await m.handleEvent('goal.create');
  await m.handleEvent('plan.complete');

  // Manually set the running wave to FAILED
  m.waves[0].state = WaveState.FAILED;

  const result = await m.handleEvent('wave.fail');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.WAVE_RETRY);

  // WAVE_RETRY -> WAVE_READY on auto
  const retryResult = await m.handleEvent('auto');
  expect(retryResult).toBe(true);
  expect(m.state).toBe(LoopState.WAVE_READY);
  expect(m.waves[0].state).toBe(WaveState.READY);
});

test('EXECUTING -> LOOP_RESET on wave.fail when retryCount >= maxRetries', async () => {
  writeWaves([{ id: 'wave-1', tasks: ['t1'] }]);
  const m = createMachine();
  await m.handleEvent('goal.create');
  await m.handleEvent('plan.complete');

  // Set retryCount >= maxRetries to trigger rollback
  m.waves[0].retryCount = 3;
  m.waves[0].maxRetries = 3;
  m.waves[0].state = WaveState.FAILED;

  // Must set up checkpoint dir + state file for restoreLoop
  const checkpointsDir = path.join(tmpDir, '.opencode/mafw/checkpoints', goalId);
  fs.mkdirSync(checkpointsDir, { recursive: true });
  fs.writeFileSync(
    path.join(checkpointsDir, 'loop-1.json'),
    JSON.stringify({ goalId, loop: 1, phase: 'EXECUTING' }, null, 2)
  );

  const result = await m.handleEvent('wave.fail');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.LOOP_RESET);
});

test('loop machine is additive: backward compatible with phase-orchestrator', async () => {
  const { transitionPhase } = await import('../../src/engine/phase-orchestrator');

  // Transition using phase-orchestrator still works
  const state = await transitionPhase(goalId, {
    from: null,
    to: 'PLANNING_COMPLETE',
    nextAction: 'CREATE_EXECUTE_SESSION'
  }, tmpDir);
  expect(state.phase).toBe('PLANNING_COMPLETE');
});

test('PASS verdict routes to PASS state', async () => {
  const m = createMachine();
  m.verdict = 'PASS';
  m.state = LoopState.VERDICT;

  const result = await m.handleEvent('auto');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.PASS);
});

test('FAIL verdict routes to FAIL state', async () => {
  const m = createMachine();
  m.verdict = 'FAIL';
  m.state = LoopState.VERDICT;

  const result = await m.handleEvent('auto');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.FAIL);
});

test('PARTIAL verdict routes to PARTIAL state', async () => {
  const m = createMachine();
  m.verdict = 'PARTIAL';
  m.state = LoopState.VERDICT;

  const result = await m.handleEvent('auto');
  expect(result).toBe(true);
  expect(m.state).toBe(LoopState.PARTIAL);
});
