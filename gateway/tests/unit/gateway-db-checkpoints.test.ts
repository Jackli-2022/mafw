/**
 * T2-1 Task 1: session_checkpoints 表 + GatewayDatabase 六方法。
 * 纯 DB 行为（无业务编排）；service 层测试见 tests/unit/checkpoint/。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GatewayDatabase, type SessionCheckpointRow } from '../../src/memory/gateway-db';

function db(): GatewayDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-ckpt-'));
  return new GatewayDatabase(path.join(dir, 'test.db'));
}

function row(
  sessionId: string,
  id: string,
  kind: 'auto' | 'manual',
  createdAt: string,
  overrides: Partial<SessionCheckpointRow> = {},
): SessionCheckpointRow {
  return {
    id,
    session_id: sessionId,
    project_dir: '/tmp/project',
    anchor_message_id: `msg_${id}`,
    snapshot_tree: null,
    untracked_json: '[]',
    kind,
    created_at: createdAt,
    ...overrides,
  };
}

test('insert + get round-trips, including null snapshot_tree', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s1', 'ckpt_a', 'auto', '2026-10-26T01:00:00Z', {
    snapshot_tree: 'a'.repeat(40),
    untracked_json: JSON.stringify(['x.txt']),
  }));
  d.insertSessionCheckpoint(row('s1', 'ckpt_b', 'manual', '2026-10-26T02:00:00Z'));

  const a = d.getSessionCheckpoint('ckpt_a')!;
  expect(a.session_id).toBe('s1');
  expect(a.snapshot_tree).toBe('a'.repeat(40));
  expect(JSON.parse(a.untracked_json)).toEqual(['x.txt']);
  expect(d.getSessionCheckpoint('ckpt_b')!.snapshot_tree).toBeNull();
  expect(d.getSessionCheckpoint('missing')).toBeUndefined();
});

test('list returns newest first and is session-scoped', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s1', 'old', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('s1', 'new', 'auto', '2026-10-26T03:00:00Z'));
  d.insertSessionCheckpoint(row('s1', 'mid', 'manual', '2026-10-26T02:00:00Z'));
  d.insertSessionCheckpoint(row('s2', 'other', 'auto', '2026-10-26T04:00:00Z'));

  expect(d.listSessionCheckpoints('s1').map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  expect(d.listSessionCheckpoints('s2').map((r) => r.id)).toEqual(['other']);
});

test('prune keeps newest 100 auto, never touches manual', () => {
  const d = db();
  for (let i = 0; i < 102; i++) {
    const mm = String(i).padStart(2, '0');
    d.insertSessionCheckpoint(row('a', `ckpt_${i}`, 'auto', `1970-01-01T00:${mm}:00Z`));
  }
  d.insertSessionCheckpoint(row('a', 'ckpt_manual', 'manual', '1970-01-01T00:00:00Z'));

  expect(d.pruneSessionAutoCheckpoints('a', 100)).toBe(2);

  const rows = d.listSessionCheckpoints('a');
  expect(rows).toHaveLength(101);
  expect(rows.find((r) => r.id === 'ckpt_manual')).toBeDefined();
  expect(rows.find((r) => r.id === 'ckpt_0')).toBeUndefined();
  expect(rows.find((r) => r.id === 'ckpt_1')).toBeUndefined();
  expect(rows.find((r) => r.id === 'ckpt_2')).toBeDefined();
});

test('prune is session-scoped and no-ops under the cap', () => {
  const d = db();
  d.insertSessionCheckpoint(row('a', 'a1', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('b', 'b1', 'auto', '2026-10-26T01:00:00Z'));

  expect(d.pruneSessionAutoCheckpoints('a', 100)).toBe(0);
  expect(d.listSessionCheckpoints('a')).toHaveLength(1);
  expect(d.listSessionCheckpoints('b')).toHaveLength(1);
});

test('deleteAfter removes strictly newer rows (all kinds), keeps target and older', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s', 'older', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'target', 'auto', '2026-10-26T02:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'newer_auto', 'auto', '2026-10-26T03:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'newer_manual', 'manual', '2026-10-26T04:00:00Z'));
  d.insertSessionCheckpoint(row('other', 'other_ckpt', 'auto', '2026-10-26T05:00:00Z'));

  expect(d.deleteSessionCheckpointsAfter('s', '2026-10-26T02:00:00Z')).toBe(2);

  expect(d.listSessionCheckpoints('s').map((r) => r.id)).toEqual(['target', 'older']);
  expect(d.listSessionCheckpoints('other')).toHaveLength(1);
});

test('deleteFrom removes the boundary row and everything newer (all kinds)', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s', 'older', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'target', 'auto', '2026-10-26T02:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'newer', 'manual', '2026-10-26T03:00:00Z'));
  d.insertSessionCheckpoint(row('other', 'other_ckpt', 'auto', '2026-10-26T02:00:00Z'));

  expect(d.deleteSessionCheckpointsFrom('s', '2026-10-26T02:00:00Z')).toBe(2);

  expect(d.listSessionCheckpoints('s').map((r) => r.id)).toEqual(['older']);
  expect(d.listSessionCheckpoints('other')).toHaveLength(1);
});

test('deleteOne removes a single checkpoint (pre-restore rollback on failed apply)', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s', 'a', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'b', 'auto', '2026-10-26T02:00:00Z'));
  d.deleteSessionCheckpoint('a');
  expect(d.listSessionCheckpoints('s').map((r) => r.id)).toEqual(['b']);
  expect(() => d.deleteSessionCheckpoint('missing')).not.toThrow();
});

test('delete removes all checkpoints of a session only', () => {
  const d = db();
  d.insertSessionCheckpoint(row('s', 'a', 'auto', '2026-10-26T01:00:00Z'));
  d.insertSessionCheckpoint(row('s', 'b', 'manual', '2026-10-26T02:00:00Z'));
  d.insertSessionCheckpoint(row('other', 'c', 'auto', '2026-10-26T03:00:00Z'));

  d.deleteSessionCheckpoints('s');

  expect(d.listSessionCheckpoints('s')).toHaveLength(0);
  expect(d.listSessionCheckpoints('other')).toHaveLength(1);
});
