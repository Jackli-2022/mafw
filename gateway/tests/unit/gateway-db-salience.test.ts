/**
 * S3.2: t1_observations.salience column + idempotent migration.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GatewayDatabase } from '../../src/memory/gateway-db';

function db(): GatewayDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-sal-'));
  return new GatewayDatabase(path.join(dir, 'test.db'));
}

test('salience persists and reads back', () => {
  const d = db();
  const t = d.beginTurn('s', 0.9);
  d.append({ session_id: 's', turn_id: t.turn_seq, trace_id: t.trace_id, source: 'user_input', content: 'hi', failure: 0, salience: 0.9 });
  expect(d.readTurn('s', t.turn_seq)[0].salience).toBeCloseTo(0.9, 2);
});

test('rows without salience read salience as null (neutral fallback)', () => {
  const d = db();
  const t = d.beginTurn('s');
  d.append({ session_id: 's', turn_id: t.turn_seq, trace_id: t.trace_id, source: 'user_input', content: 'x', failure: 0 });
  expect(d.readTurn('s', t.turn_seq)[0].salience).toBeNull();
});

test('migration is idempotent (re-open same db)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-sal3-'));
  const p = path.join(dir, 'test.db');
  const a = new GatewayDatabase(p);
  const t = a.beginTurn('s', 0.3);
  a.append({ session_id: 's', turn_id: t.turn_seq, trace_id: t.trace_id, source: 'user_input', content: 'x', failure: 0, salience: 0.3 });
  expect(() => new GatewayDatabase(p)).not.toThrow();
});
