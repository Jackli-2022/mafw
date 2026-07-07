import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  transitionPhase,
  recordSession,
  canExecuteInPhase,
  updateWaveProgress,
  shouldStartNextLoop,
  startNextLoop
} from '../../../src/engine/phase-orchestrator';
import { initState } from '../../../src/utils/state';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-phase-'));
  fs.mkdirSync(path.join(tmpDir, '.opencode', 'mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.opencode', 'mafw', 'requests'), { recursive: true });
  initState('001-auth', tmpDir);
  fs.writeFileSync(
    path.join(tmpDir, '.opencode', 'mafw', 'requests', '001-auth.json'),
    JSON.stringify({ maxLoops: 5 })
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('transitionPhase accepts valid transition', async () => {
  const state = await transitionPhase('001-auth', { from: 'PLANNING', to: 'PLANNING_COMPLETE', nextAction: 'CREATE_EXECUTE_SESSION' }, tmpDir);
  expect(state.phase).toBe('PLANNING_COMPLETE');
  expect(state.nextAction).toBe('CREATE_EXECUTE_SESSION');
});

test('transitionPhase accepts any transition (validation removed)', async () => {
  const state = await transitionPhase('001-auth', { from: 'PLANNING', to: 'REVIEWING', nextAction: 'CREATE_REVIEW_SESSION' }, tmpDir);
  expect(state.phase).toBe('REVIEWING');
  expect(state.nextAction).toBe('CREATE_REVIEW_SESSION');
});

test('recordSession writes active session', async () => {
  const state = await recordSession('001-auth', 'plan', 'sess-1', tmpDir);
  expect(state.sessions.plan.id).toBe('sess-1');
  expect(state.sessions.plan.active).toBe(true);
});

test('canExecuteInPhase checks current phase', async () => {
  expect(await canExecuteInPhase('001-auth', 'PLANNING', tmpDir)).toBe(true);
  expect(await canExecuteInPhase('001-auth', 'EXECUTING', tmpDir)).toBe(false);
});

test('updateWaveProgress updates wave counters', async () => {
  const state = await updateWaveProgress('001-auth', 2, 5, tmpDir);
  expect(state.currentWave).toBe(2);
  expect(state.totalWaves).toBe(5);
});

test('shouldStartNextLoop returns false at maxLoops', async () => {
  await transitionPhase('001-auth', { from: 'PLANNING', to: 'PLANNING_COMPLETE', nextAction: 'CREATE_EXECUTE_SESSION' }, tmpDir);
  await startNextLoop('001-auth', tmpDir);
  await startNextLoop('001-auth', tmpDir);
  await startNextLoop('001-auth', tmpDir);
  await startNextLoop('001-auth', tmpDir);
  const result = await shouldStartNextLoop('001-auth', tmpDir);
  expect(result.should).toBe(false);
});
