import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('GatewayDatabase T1 turn identity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-identity-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('beginTurn allocates monotonically and nextTurnId only peeks', () => {
    const a = db.beginTurn('s1', 0.7);
    const b = db.beginTurn('s1');
    expect(a.turn_seq).toBe(1);
    expect(b.turn_seq).toBe(2);
    expect(a.trace_id).toMatch(/^t1t_/);
    expect(a.encoding_salience).toBeCloseTo(0.7, 6);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.currentTurn('s1')?.trace_id).toBe(b.trace_id);
  });

  test('archiving every active row does not reset the sequence', () => {
    const first = db.beginTurn('s1');
    (db as any).db.prepare(
      `INSERT INTO t1_observations (session_id, turn_id, source, content, failure)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('s1', first.turn_seq, 'user_input', 'first', 0);
    db.archiveTurn('s1', first.turn_seq);

    expect(db.count()).toBe(0);
    expect(db.nextTurnId('s1')).toBe(2);
    const second = db.beginTurn('s1');
    expect(second.turn_seq).toBe(2);
    expect(second.trace_id).not.toBe(first.trace_id);
  });

  test('sequence survives reopening the database', () => {
    const p = path.join(dir, 'persist.db');
    const a = new GatewayDatabase(p);
    a.beginTurn('s1');
    a.beginTurn('s1');
    a.close();

    db.close(); // close the beforeEach instance before replacing it
    db = new GatewayDatabase(p);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.beginTurn('s1').turn_seq).toBe(3);
  });

  test('sessions have independent sequences', () => {
    db.beginTurn('a');
    db.beginTurn('a');
    expect(db.beginTurn('b').turn_seq).toBe(1);
    expect(db.nextTurnId('a')).toBe(3);
  });

  test('untracked legacy archive rows raise the next sequence', () => {
    (db as any).db.prepare(
      `INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 40, 'user_input', 'legacy', 0, 1);
    expect(db.nextTurnId('s1')).toBe(41);
    expect(db.beginTurn('s1').turn_seq).toBe(41);
  });
});
