import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateLockManager } from '../../src/engine/state-lock';
import { WaveDependencyManager } from '../../src/engine/wave-dependency';
import { OptimisticStateSync } from '../../src/engine/optimistic-sync';

// ── StateLockManager ──────────────────────────────────────────────────────────

test('acquire and release lock', async () => {
  const mgr = new StateLockManager();
  const acquired = await mgr.acquireLock('g1', 1, 1, 'agent-a');
  expect(acquired).toBe(true);
  expect(mgr.isLocked('g1', 1, 1)).toBe(true);

  await mgr.releaseLock('g1', 1, 1);
  expect(mgr.isLocked('g1', 1, 1)).toBe(false);
});

test('lock prevents second acquisition', async () => {
  const mgr = new StateLockManager();
  await mgr.acquireLock('g1', 1, 1, 'agent-a');
  const acquired = await mgr.acquireLock('g1', 1, 1, 'agent-b');
  expect(acquired).toBe(false);
});

test('expired lock can be re-acquired', async () => {
  jest.useFakeTimers();
  const mgr = new StateLockManager({ defaultTimeout: 100 });
  await mgr.acquireLock('g1', 1, 1, 'agent-a');
  jest.advanceTimersByTime(150);
  const acquired = await mgr.acquireLock('g1', 1, 1, 'agent-b');
  expect(acquired).toBe(true);
  jest.useRealTimers();
});

test('heartbeat extends expiry', async () => {
  jest.useFakeTimers();
  const mgr = new StateLockManager({ defaultTimeout: 100 });
  await mgr.acquireLock('g1', 1, 1, 'agent-a');
  jest.advanceTimersByTime(80);
  await mgr.heartbeat('g1', 1, 1);
  jest.advanceTimersByTime(80);
  expect(mgr.isLocked('g1', 1, 1)).toBe(true);
  jest.useRealTimers();
});

test('sweep cleans expired locks', async () => {
  jest.useFakeTimers();
  const mgr = new StateLockManager({ defaultTimeout: 100, sweepIntervalMs: 200 });
  await mgr.acquireLock('g1', 1, 1, 'agent-a');
  expect(mgr.isLocked('g1', 1, 1)).toBe(true);
  jest.advanceTimersByTime(250);
  expect(mgr.isLocked('g1', 1, 1)).toBe(false);
  mgr.stop();
  jest.useRealTimers();
});

test('releaseAllForGoal works', async () => {
  const mgr = new StateLockManager();
  await mgr.acquireLock('g1', 1, 1, 'agent-a');
  await mgr.acquireLock('g1', 2, 1, 'agent-b');
  await mgr.acquireLock('g2', 1, 1, 'agent-c');
  expect(mgr.getActiveLocks()).toHaveLength(3);
  await mgr.releaseAllForGoal('g1');
  expect(mgr.getActiveLocks()).toHaveLength(1);
  expect(mgr.isLocked('g1', 1, 1)).toBe(false);
  expect(mgr.isLocked('g2', 1, 1)).toBe(true);
});

// ── WaveDependencyManager ──────────────────────────────────────────────────────

test('canStartWave returns true when deps empty', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'pending' }
  ]);
  expect(mgr.canStartWave('g1', 1, 1)).toBe(true);
});

test('canStartWave returns false when dep not completed', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'completed' },
    { waveNum: 2, dependsOn: [1], status: 'pending' }
  ]);
  expect(mgr.canStartWave('g1', 1, 2)).toBe(true);
  mgr.updateWaveStatus('g1', 1, 1, 'pending');
  expect(mgr.canStartWave('g1', 1, 2)).toBe(false);
});

test('updateWaveStatus triggers ready waves', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'pending' },
    { waveNum: 2, dependsOn: [1], status: 'pending' }
  ]);
  expect(mgr.getReadyWaves('g1', 1)).toEqual([1]);
  mgr.updateWaveStatus('g1', 1, 1, 'completed');
  expect(mgr.getReadyWaves('g1', 1)).toEqual([2]);
});

test('getReadyWaves returns correct list', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'completed' },
    { waveNum: 2, dependsOn: [1], status: 'pending' },
    { waveNum: 3, dependsOn: [2], status: 'pending' }
  ]);
  expect(mgr.getReadyWaves('g1', 1)).toEqual([2]);
});

test('getBlockedWaves returns correct list', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'completed' },
    { waveNum: 2, dependsOn: [1], status: 'pending' },
    { waveNum: 3, dependsOn: [2], status: 'pending' }
  ]);
  expect(mgr.getBlockedWaves('g1', 1)).toEqual([3]);
});

test('clear removes data', () => {
  const mgr = new WaveDependencyManager();
  mgr.setDependencies('g1', 1, [
    { waveNum: 1, dependsOn: [], status: 'pending' }
  ]);
  expect(mgr.getAllStatus('g1', 1)).toHaveLength(1);
  mgr.clear('g1', 1);
  expect(mgr.getAllStatus('g1', 1)).toHaveLength(0);
});

// ── OptimisticStateSync ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-concurrency-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('updateState succeeds with correct version', async () => {
  const stateDir = path.join(tmpDir, '.opencode', 'mafw', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'g1.json'),
    JSON.stringify({ goalId: 'g1', version: 0 })
  );
  const sync = new OptimisticStateSync(tmpDir);
  const result = await sync.updateState('g1', { phase: 'EXECUTING' }, 0);
  expect(result).toBe(true);
  const content = JSON.parse(
    fs.readFileSync(path.join(stateDir, 'g1.json'), 'utf-8')
  );
  expect(content.phase).toBe('EXECUTING');
  expect(content.version).toBe(1);
});

test('updateState fails with wrong version', async () => {
  const stateDir = path.join(tmpDir, '.opencode', 'mafw', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'g1.json'),
    JSON.stringify({ goalId: 'g1', version: 5 })
  );
  const sync = new OptimisticStateSync(tmpDir);
  const result = await sync.updateState('g1', { phase: 'EXECUTING' }, 3);
  expect(result).toBe(false);
  const content = JSON.parse(
    fs.readFileSync(path.join(stateDir, 'g1.json'), 'utf-8')
  );
  expect(content.version).toBe(5);
});

test('readCurrentVersion returns correct value', async () => {
  const sync = new OptimisticStateSync(tmpDir);
  let v = await sync.readCurrentVersion('g1');
  expect(v).toBe(-1);

  const stateDir = path.join(tmpDir, '.opencode', 'mafw', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'g1.json'),
    JSON.stringify({ goalId: 'g1', version: 3 })
  );
  v = await sync.readCurrentVersion('g1');
  expect(v).toBe(3);
});
