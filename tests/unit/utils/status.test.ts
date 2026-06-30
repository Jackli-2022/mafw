import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StatusManager } from '../../../src/utils/status';

let tmpDir: string;
let manager: StatusManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-status-'));
  manager = new StatusManager(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('update creates new goal entry', () => {
  manager.update('001-auth', { state: 'RUNNING', loop: 1, wave: 1, task: 't1', progress: '10%', sessionId: 's1', directory: tmpDir });
  const all = manager.readAll();
  expect(all).toHaveLength(1);
  expect(all[0].goalId).toBe('001-auth');
  expect(all[0].state).toBe('RUNNING');
});

test('update preserves existing goals', () => {
  manager.update('001-auth', { state: 'RUNNING' });
  manager.update('002-viz', { state: 'PENDING' });
  expect(manager.readAll()).toHaveLength(2);
  expect(manager.read('001-auth')?.state).toBe('RUNNING');
  expect(manager.read('002-viz')?.state).toBe('PENDING');
});

test('write includes global header with activeGoals count', () => {
  manager.update('001-auth', { state: 'RUNNING' });
  manager.update('002-viz', { state: 'COMPLETED' });
  const content = fs.readFileSync(path.join(tmpDir, '.opencode', 'mafw', 'STATUS.md'), 'utf-8');
  expect(content).toContain('# MAFW Status');
  expect(content).toContain('activeGoals: 1');
});

test('write includes global header with pendingGoals count', () => {
  manager.update('001-auth', { state: 'PENDING' });
  manager.update('002-viz', { state: 'RUNNING' });
  const content = fs.readFileSync(path.join(tmpDir, '.opencode', 'mafw', 'STATUS.md'), 'utf-8');
  expect(content).toContain('pendingGoals: 1');
});

test('isStuck returns true for old heartbeat', () => {
  manager.update('001-auth', { state: 'RUNNING', lastHeartbeat: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
  expect(manager.isStuck('001-auth')).toBe(true);
});
