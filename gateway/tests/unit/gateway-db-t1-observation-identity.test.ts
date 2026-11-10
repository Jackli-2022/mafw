import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase, T1Observation } from '../../src/memory/gateway-db';

describe('T1 observation identity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-obs-id-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('append stores the trace, generates a stable observation key, and updates salience', () => {
    const t = db.beginTurn('s1', 0.4);
    const id = db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'tool_result', content: 'output', failure: 0, salience: 0.9,
    });
    expect(id).not.toBeNull();
    const row = db.readTurn('s1', t.turn_seq)[0];
    expect(row.trace_id).toBe(t.trace_id);
    expect(row.observation_key).toMatch(/^t1o_/);
    expect(row.salience).toBeCloseTo(0.9, 6);
    expect(db.currentTurn('s1')?.encoding_salience).toBeCloseTo(0.9, 6);
  });

  test('append rejects missing or unknown trace ids', () => {
    expect(() => db.append({
      session_id: 's1', turn_id: 1, source: 'user_input', content: 'x', failure: 0,
    } as any)).toThrow('trace_id required');
    expect(() => db.append({
      session_id: 's1', turn_id: 1, trace_id: 't1t_missing',
      source: 'user_input', content: 'x', failure: 0,
    })).toThrow('unknown trace_id');
  });

  test('legacy rows without identity columns read back null (no lie, no throw)', () => {
    // Seed a row exactly as a pre-Task-4 database looks: the migrated
    // trace_id / observation_key columns exist but are NULL for old rows.
    db.getStore()
      .prepare(
        `INSERT INTO t1_observations (session_id, turn_id, source, content, failure)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('s-legacy', 1, 'user_input', 'pre-task-4 row', 0);

    const row = db.readTurn('s-legacy', 1)[0];
    expect(row.trace_id).toBeNull();
    expect(row.observation_key).toBeNull();

    // Type-level guard: the read DTO must permit null on both fields. With a
    // non-nullable `string`, `null extends string` is false, so these
    // constants would fail to compile (and Task 3's `row.trace_id.trim()`
    // would blow up at runtime).
    type NullableOf<T> = null extends T ? true : false;
    const traceNullable: NullableOf<T1Observation['trace_id']> = true;
    const keyNullable: NullableOf<T1Observation['observation_key']> = true;
    void traceNullable;
    void keyNullable;
  });

});
