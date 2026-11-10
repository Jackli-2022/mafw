import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('T1 archive identity fidelity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-archive-id-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('archive preserves trace, observation key and salience', () => {
    const t = db.beginTurn('s1', 0.6);
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'question', failure: 0, salience: 0.6,
    });
    const before = db.readTurn('s1', t.turn_seq)[0];
    expect(db.archiveTurn('s1', t.turn_seq)).toBe(1);

    const after = db.readArchiveTurn('s1', t.turn_seq)[0];
    expect(after.trace_id).toBe(before.trace_id);
    expect(after.observation_key).toBe(before.observation_key);
    expect(after.salience).toBeCloseTo(0.6, 6);
    expect(db.currentTurn('s1')?.archived_at).not.toBeNull();
  });

  test('readTrace works before and after archival', () => {
    const t = db.beginTurn('s1');
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'q', failure: 0,
    });
    expect(db.readTrace(t.trace_id)?.archived).toBe(false);
    db.archiveTurn('s1', t.turn_seq);
    const read = db.readTrace(t.trace_id);
    expect(read?.turn.trace_id).toBe(t.trace_id);
    expect(read?.rows.map((r) => r.content)).toEqual(['q']);
    expect(read?.archived).toBe(true);
    expect(db.readTrace('t1t_missing')).toBeNull();
  });

  test('late append reopens the archived turn and keeps the same trace', () => {
    const t = db.beginTurn('s1');
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'ask', failure: 0,
    });
    db.archiveTurn('s1', t.turn_seq);
    expect(db.currentTurn('s1')?.archived_at).not.toBeNull();
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'tool_result', content: 'late', failure: 0,
    });
    expect(db.currentTurn('s1')?.archived_at).toBeNull();
    expect(db.readTrace(t.trace_id)?.rows.map((r) => r.content)).toEqual(['ask', 'late']);
  });
});
