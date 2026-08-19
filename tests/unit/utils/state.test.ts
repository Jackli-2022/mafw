import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initState,
  updateState,
  loadState,
  loadRequest,
  loadWaves,
  loadReceipts,
  extractGoalId
} from '../../../gateway/src/core/utils/state';

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-state-'));
  projectDir = tmpDir;
  fs.mkdirSync(path.join(projectDir, '.mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.mafw', 'requests'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.mafw', 'goals'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('initState writes a valid initial state file', () => {
  initState('001-auth', projectDir);
  const statePath = path.join(projectDir, '.mafw', 'state', '001-auth.json');
  expect(fs.existsSync(statePath)).toBe(true);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  expect(state.goalId).toBe('001-auth');
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
});

test('updateState atomically patches state', async () => {
  initState('001-auth', projectDir);
  const updated = await updateState('001-auth', { phase: 'PLANNING_COMPLETE', nextAction: 'CREATE_EXECUTE_SESSION' }, projectDir);
  expect(updated.phase).toBe('PLANNING_COMPLETE');
  expect(updated.nextAction).toBe('CREATE_EXECUTE_SESSION');
  expect(fs.existsSync(path.join(projectDir, '.mafw', 'state', '001-auth.json.tmp'))).toBe(false);
});

test('loadState throws for missing file', async () => {
  await expect(loadState('missing', projectDir)).rejects.toThrow(/State file not found/);
});

test('loadRequest parses request file', async () => {
  const reqPath = path.join(projectDir, '.mafw', 'requests', '001-auth.json');
  fs.writeFileSync(reqPath, JSON.stringify({ goalId: '001-auth', title: 'Auth', metrics: {}, boundaries: [] }));
  const req = await loadRequest('001-auth', projectDir);
  expect(req.title).toBe('Auth');
});

test('loadWaves returns empty array when missing', async () => {
  const waves = await loadWaves('001-auth', projectDir);
  expect(waves).toEqual([]);
});

test('loadReceipts returns empty array when missing', async () => {
  const receipts = await loadReceipts('001-auth', projectDir);
  expect(receipts).toEqual([]);
});

test('extractGoalId supports /skill mafw-plan 001-auth', () => {
  expect(extractGoalId('/skill mafw-plan 001-auth')).toBe('001-auth');
});

test('extractGoalId supports raw goal id', () => {
  expect(extractGoalId('001-auth')).toBe('001-auth');
});

test('loadRequest throws for missing file', async () => {
  await expect(loadRequest('missing', projectDir)).rejects.toThrow(/Request file not found/);
});

test('loadState throws for corrupt JSON', async () => {
  const statePath = path.join(projectDir, '.mafw', 'state', 'bad.json');
  fs.writeFileSync(statePath, '{ not json');
  await expect(loadState('bad', projectDir)).rejects.toThrow(/Failed to parse/);
});

test('loadWaves throws for corrupt JSON', async () => {
  fs.writeFileSync(path.join(projectDir, '.mafw', 'waves.json'), 'invalid');
  await expect(loadWaves('001-auth', projectDir)).rejects.toThrow(/Failed to parse/);
});

test('updateState throws for missing goal', async () => {
  await expect(updateState('missing', { phase: 'PLANNING' }, projectDir)).rejects.toThrow(/State file not found/);
});

test('extractGoalId returns empty for empty message', () => {
  expect(extractGoalId('')).toBe('');
});
