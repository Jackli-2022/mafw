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
  d.append({ session_id: 's', turn_id: 1, source: 'user_input', content: 'hi', failure: 0, salience: 0.9 } as any);
  expect(d.readTurn('s', 1)[0].salience).toBeCloseTo(0.9, 2);
});

test('legacy rows read salience as null (neutral fallback)', () => {
  const d = db();
  d.append({ session_id: 's', turn_id: 1, source: 'user_input', content: 'x', failure: 0 } as any);
  expect(d.readTurn('s', 1)[0].salience).toBeNull();
});

test('migration is idempotent (re-open same db)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-db-sal3-'));
  const p = path.join(dir, 'test.db');
  const a = new GatewayDatabase(p);
  a.append({ session_id: 's', turn_id: 1, source: 'user_input', content: 'x', failure: 0, salience: 0.3 } as any);
  expect(() => new GatewayDatabase(p)).not.toThrow();
});
