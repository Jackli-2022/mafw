import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sessionEndingHook } from '../../src/hooks/session-ending';
import { initState, updateState } from '../../gateway/src/core/utils/state';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-precompact-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('pre-compact detects high-energy memories and logs preservation', async () => {
  const parametricDir = path.join(tmpDir, '.mafw', 'parametric');
  fs.mkdirSync(parametricDir, { recursive: true });
  fs.writeFileSync(path.join(parametricDir, 'high-energy.json'), JSON.stringify({ id: 'delta-1', energy_score: 0.95 }), 'utf-8');
  fs.writeFileSync(path.join(parametricDir, 'low-energy.json'), JSON.stringify({ id: 'delta-2', energy_score: 0.3 }), 'utf-8');

  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir });

  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('[mafw:pre-compact] Preserving 1 high-energy memories')
  );
});

test('pre-compact does not log when no high-energy memories exist', async () => {
  const parametricDir = path.join(tmpDir, '.mafw', 'parametric');
  fs.mkdirSync(parametricDir, { recursive: true });
  fs.writeFileSync(path.join(parametricDir, 'low-energy.json'), JSON.stringify({ id: 'delta-1', energy_score: 0.3 }), 'utf-8');

  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir });

  const calls = (console.log as jest.Mock).mock.calls.filter(
    ([msg]: string[]) => String(msg).includes('[mafw:pre-compact]')
  );
  expect(calls.length).toBe(0);
});

test('pre-compact does not crash when parametric directory is missing', async () => {
  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await expect(sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir })).resolves.toBeUndefined();
});

test('pre-compact handles unparseable files without crashing', async () => {
  const parametricDir = path.join(tmpDir, '.mafw', 'parametric');
  fs.mkdirSync(parametricDir, { recursive: true });
  fs.writeFileSync(path.join(parametricDir, 'corrupt.json'), 'not-json', 'utf-8');
  fs.writeFileSync(path.join(parametricDir, 'high-energy.json'), JSON.stringify({ id: 'delta-1', energy_score: 0.95 }), 'utf-8');

  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  await sessionEndingHook({ sessionId: 'sess-1', projectDir: tmpDir });

  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining('[mafw:pre-compact] Preserving 1 high-energy memories')
  );
});
