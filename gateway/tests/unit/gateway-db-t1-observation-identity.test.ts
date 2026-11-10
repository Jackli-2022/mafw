import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

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

});
