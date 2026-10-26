import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase, type SessionDataPartRow } from '../../src/memory/gateway-db';

function db(): GatewayDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-dparts-'));
  return new GatewayDatabase(path.join(dir, 'test.db'));
}

function row(session: string, id: string, message: string, at: string, data: unknown = { v: 1 }): SessionDataPartRow {
  return {
    session_id: session,
    id,
    message_id: message,
    type: 'data-probe',
    data_json: JSON.stringify(data),
    created_at: at,
    updated_at: at,
  };
}

test('upsert same (session,id) updates payload, not row count', () => {
  const d = db();
  d.upsertSessionDataPart(row('s1', 'data_x', 'm1', '2026-10-26T01:00:00Z', { v: 1 }));
  d.upsertSessionDataPart({
    ...row('s1', 'data_x', 'm1', '2026-10-26T01:00:00Z', { v: 2 }),
    updated_at: '2026-10-26T02:00:00Z',
  });
  const got = d.getSessionDataPart('s1', 'data_x')!;
  expect(JSON.parse(got.data_json)).toEqual({ v: 2 });
  expect(got.updated_at).toBe('2026-10-26T02:00:00Z');
  expect(d.listSessionDataParts('s1')).toHaveLength(1);
});

test('same id is isolated across sessions', () => {
  const d = db();
  d.upsertSessionDataPart(row('s1', 'data_x', 'm1', '2026-10-26T01:00:00Z', { who: 's1' }));
  d.upsertSessionDataPart(row('s2', 'data_x', 'm2', '2026-10-26T01:00:00Z', { who: 's2' }));
  expect(JSON.parse(d.getSessionDataPart('s1', 'data_x')!.data_json)).toEqual({ who: 's1' });
  expect(JSON.parse(d.getSessionDataPart('s2', 'data_x')!.data_json)).toEqual({ who: 's2' });
});

test('list filters by messageIds and orders by created_at', () => {
  const d = db();
  d.upsertSessionDataPart(row('s1', 'data_a', 'm1', '2026-10-26T01:00:00Z'));
  d.upsertSessionDataPart(row('s1', 'data_b', 'm2', '2026-10-26T02:00:00Z'));
  d.upsertSessionDataPart(row('s1', 'data_c', 'm3', '2026-10-26T03:00:00Z'));
  expect(d.listSessionDataParts('s1', { messageIds: ['m3', 'm1'] }).map((r) => r.id))
    .toEqual(['data_a', 'data_c']);
  expect(d.listSessionDataParts('s1').map((r) => r.id)).toEqual(['data_a', 'data_b', 'data_c']);
});

test('prune keeps newest N rows; delete one and all', () => {
  const d = db();
  for (let i = 0; i < 5; i++) {
    d.upsertSessionDataPart(row('s', `data_${i}`, 'm', `2026-10-26T0${i}:00:00Z`));
  }
  expect(d.pruneSessionDataParts('s', 3)).toBe(2);
  expect(d.listSessionDataParts('s').map((r) => r.id)).toEqual(['data_2', 'data_3', 'data_4']);
  d.deleteSessionDataPart('s', 'data_2');
  expect(d.listSessionDataParts('s').map((r) => r.id)).toEqual(['data_3', 'data_4']);
  d.deleteSessionDataParts('s');
  expect(d.listSessionDataParts('s')).toHaveLength(0);
});
