/**
 * T2-2 Task 1: run_states 表 + GatewayDatabase 方法。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GatewayDatabase, type RunStateRow } from '../../src/memory/gateway-db';

function db(): GatewayDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-runs-'));
  return new GatewayDatabase(path.join(dir, 'test.db'));
}

function row(
  sessionId: string,
  id: string,
  status: string,
  createdAt: string,
  overrides: Partial<RunStateRow> = {},
): RunStateRow {
  return {
    id,
    session_id: sessionId,
    project_dir: '/tmp/project',
    status,
    reason: null,
    brief_json: JSON.stringify({ lastUserText: 'hi', lastAssistantTail: '', anchorMessageID: 'u1', queuedCount: 0 }),
    created_at: createdAt,
    suspended_at: createdAt,
    resumed_at: null,
    finished_at: null,
    ...overrides,
  };
}

test('insert + get round-trips null fields', () => {
  const d = db();
  d.insertRunState(row('s1', 'run_a', 'suspended', '2026-10-26T01:00:00Z'));
  const a = d.getRunState('run_a')!;
  expect(a.session_id).toBe('s1');
  expect(a.status).toBe('suspended');
  expect(a.resumed_at).toBeNull();
  expect(a.reason).toBeNull();
  expect(JSON.parse(a.brief_json).anchorMessageID).toBe('u1');
  expect(d.getRunState('missing')).toBeUndefined();
});

test('getActiveRunState returns only suspended/resumed and newest first', () => {
  const d = db();
  d.insertRunState(row('s1', 'run_done', 'completed', '2026-10-26T03:00:00Z'));
  d.insertRunState(row('s1', 'run_old', 'suspended', '2026-10-26T01:00:00Z'));
  d.insertRunState(row('s1', 'run_new', 'resumed', '2026-10-26T02:00:00Z'));
  d.insertRunState(row('s2', 'other', 'suspended', '2026-10-26T04:00:00Z'));

  expect(d.getActiveRunState('s1')!.id).toBe('run_new');
  expect(d.getActiveRunState('s2')!.id).toBe('other');
  expect(d.listActiveRunStates().map((r) => r.id).sort()).toEqual(['other', 'run_new', 'run_old']);
});

test('updateRunState patches only provided fields', () => {
  const d = db();
  d.insertRunState(row('s1', 'run_a', 'suspended', '2026-10-26T01:00:00Z'));
  d.updateRunState('run_a', { status: 'resumed', resumed_at: '2026-10-26T01:01:00Z' });
  const a = d.getRunState('run_a')!;
  expect(a.status).toBe('resumed');
  expect(a.resumed_at).toBe('2026-10-26T01:01:00Z');
  expect(a.reason).toBeNull();
  expect(() => d.updateRunState('missing', { status: 'completed' })).not.toThrow();
});

test('prune keeps newest terminal runs but never active ones', () => {
  const d = db();
  for (let i = 0; i < 22; i++) {
    const mm = String(i).padStart(2, '0');
    d.insertRunState(row('s', `done_${i}`, 'completed', `2026-10-26T00:${mm}:00Z`));
  }
  d.insertRunState(row('s', 'suspended_old', 'suspended', '2026-10-26T00:00:30Z'));
  d.insertRunState(row('s', 'resumed_new', 'resumed', '2026-10-26T00:00:40Z'));

  expect(d.pruneRunStates('s', 20)).toBe(2);

  const ids = d.listActiveRunStates().map((r) => r.id).sort();
  expect(ids).toEqual(['resumed_new', 'suspended_old']);
  expect(d.getRunState('done_0')).toBeUndefined();
  expect(d.getRunState('done_1')).toBeUndefined();
  expect(d.getRunState('done_2')).toBeDefined();
});

test('deleteRunStates removes a session only', () => {
  const d = db();
  d.insertRunState(row('s', 'a', 'suspended', '2026-10-26T01:00:00Z'));
  d.insertRunState(row('s', 'b', 'completed', '2026-10-26T02:00:00Z'));
  d.insertRunState(row('other', 'c', 'suspended', '2026-10-26T03:00:00Z'));
  d.deleteRunStates('s');
  expect(d.getRunState('a')).toBeUndefined();
  expect(d.getRunState('b')).toBeUndefined();
  expect(d.getRunState('c')).toBeDefined();
});
