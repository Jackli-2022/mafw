import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sessionEndingHook } from '../../../src/hooks/session-ending';
import { initState, updateState } from '../../../src/utils/state';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hook-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('sessionEndingHook recreates session when state still WAIT_PHASE_COMPLETE', async () => {
  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
  expect(state.error).toBe('session_ended_without_state_update');
  expect(state.sessions.plan.active).toBe(false);
});

test('sessionEndingHook is no-op when state already updated', async () => {
  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'CREATE_EXECUTE_SESSION',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('CREATE_EXECUTE_SESSION');
});

test('sessionEndingHook is no-op when state directory is missing', async () => {
  fs.rmSync(path.join(tmpDir, '.opencode'), { recursive: true, force: true });

  await expect(sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir })).resolves.toBeUndefined();
});

test('sessionEndingHook survives a missing state file for a matched session', async () => {
  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  fs.rmSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'));

  await expect(sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir })).resolves.toBeUndefined();
});
