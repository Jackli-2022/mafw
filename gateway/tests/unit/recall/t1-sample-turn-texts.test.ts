import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

describe('GatewayDatabase.sampleTurnTexts', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-sample-texts-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(session: string, content: string) {
    const turn = db.beginTurn(session);
    db.append({
      session_id: session,
      turn_id: turn.turn_seq,
      trace_id: turn.trace_id,
      source: 'user_input',
      content,
      failure: 0,
    });
    return turn;
  }

  test('dedupes before applying the limit', () => {
  const raw = db.getStore();
  const insertTurn = raw.prepare(
    'INSERT INTO t1_turns (trace_id, session_id, turn_seq, created_at) VALUES (?, ?, ?, unixepoch())',
  );
  insertTurn.run('aaa', 's1', 1);
  insertTurn.run('aab', 's2', 1);
  insertTurn.run('zzz', 's3', 1);
  db.append({ session_id: 's1', turn_id: 1, trace_id: 'aaa', source: 'user_input', content: 'alpha', failure: 0 });
  db.append({ session_id: 's2', turn_id: 1, trace_id: 'aab', source: 'user_input', content: 'alpha', failure: 0 });
  db.append({ session_id: 's3', turn_id: 1, trace_id: 'zzz', source: 'user_input', content: 'beta', failure: 0 });
  expect(db.sampleTurnTexts(2)).toEqual(['alpha', 'beta']);
});

test('returns [] on a fresh database', () => {
    expect(db.sampleTurnTexts(10)).toEqual([]);
  });

  test('samples deterministic, deduped, truncated text from active and archived rows', () => {
    seed('s1', 'alpha');
    seed('s2', 'beta');
    seed('s3', 'alpha');
    const archived = seed('s4', 'gamma');
    db.archiveTurn('s4', archived.turn_seq);

    const texts = db.sampleTurnTexts(10);
    expect(new Set(texts)).toEqual(new Set(['alpha', 'beta', 'gamma']));
    expect(db.sampleTurnTexts(10)).toEqual(texts);
    expect(db.sampleTurnTexts(2)).toHaveLength(2);
    expect(db.sampleTurnTexts(0)).toEqual([]);

    seed('s5', 'x'.repeat(900));
    expect(db.sampleTurnTexts(10).some((text) => text.length === 500)).toBe(true);
  });
});
