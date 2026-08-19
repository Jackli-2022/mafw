import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../gateway/src/core/compression/vector-index', () => ({
  VectorIndex: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue([]),
    size: 0,
    addDocument: jest.fn(),
    addDocuments: jest.fn(),
    removeDocument: jest.fn(),
    clear: jest.fn(),
    save: jest.fn(),
    load: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
  }))
}));

import MafwPlugin from '../../src/plugin';
import { initState, updateState } from '../../gateway/src/core/utils/state';

let tmpDir: string;
let originalFetch: typeof global.fetch;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-'));
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
});

afterEach(() => {
  global.fetch = originalFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('/goal command runs the mafw-goal skill', async () => {
  const plugin = await MafwPlugin({ directory: tmpDir });
  const runSkill = jest.fn().mockResolvedValue({ confirmed: true, goalId: '20260101-123', title: 'Test Goal' });

  await plugin.command.goal.execute('build auth system', { runSkill });

  expect(runSkill).toHaveBeenCalledWith('mafw-goal', { text: 'build auth system' });
});

test('/goal command handles empty args', async () => {
  const plugin = await MafwPlugin({ directory: tmpDir });
  const runSkill = jest.fn().mockResolvedValue({ confirmed: true, goalId: '20260101-123', title: 'Test Goal' });

  await plugin.command.goal.execute('', { runSkill });

  expect(runSkill).toHaveBeenCalledWith('mafw-goal', { text: '' });
});

test('/goal command handles very long text', async () => {
  const plugin = await MafwPlugin({ directory: tmpDir });
  const longText = 'x'.repeat(10000);
  const runSkill = jest.fn().mockResolvedValue({ confirmed: true, goalId: '20260101-123', title: 'Test Goal' });

  await plugin.command.goal.execute(longText, { runSkill });

  expect(runSkill).toHaveBeenCalledWith('mafw-goal', { text: longText });
});

test('status command returns fallback when STATUS.md missing', async () => {
  const plugin = await MafwPlugin({ directory: tmpDir });
  const result = await plugin.command.status.execute('', {});
  expect(result.text).toContain('No active Goals');
});

test("hooks['session.end'] fallback delegates to sessionEndingHook", async () => {
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  initState('001-auth', tmpDir);
  await updateState('001-auth', {
    nextAction: 'WAIT_PHASE_COMPLETE',
    sessions: { plan: { id: 'sess-1', createdAt: new Date().toISOString(), active: true } }
  }, tmpDir);

  const plugin = await MafwPlugin({ directory: tmpDir });
  await plugin.hooks['session.end']({ sessionID: 'sess-1', projectDir: tmpDir });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
  expect(state.error).toBe('session_ended_without_state_update');
  expect(state.sessions.plan.active).toBe(false);
});

