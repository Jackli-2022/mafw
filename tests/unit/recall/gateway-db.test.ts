import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';

describe('GatewayDatabase (SQLite observation + kv store)', () => {
  let db: GatewayDatabase;

  beforeEach(() => {
    db = new GatewayDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('nextTurnId starts at 1 and increments per user message', () => {
    expect(db.nextTurnId('s1')).toBe(1);
    db.append({ session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'hello', failure: 0 });
    expect(db.nextTurnId('s1')).toBe(2);
    // other sessions independent
    expect(db.nextTurnId('s2')).toBe(1);
  });

  test('currentTurnId reuses the latest turn for non-user observations', () => {
    expect(db.currentTurnId('s1')).toBe(0);
    db.append({ session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'hello', failure: 0 });
    expect(db.currentTurnId('s1')).toBe(1);
  });

  test('database-level dedup ignores exact duplicates', () => {
    const obs = { session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'hello', failure: 0 };
    const first = db.append(obs);
    const second = db.append(obs);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(db.count()).toBe(1);
  });

  test('listTurns summarizes user_input presence and response counts', () => {
    db.append({ session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'hello', failure: 0 });
    db.append({ session_id: 's1', turn_id: 1, source: 'assistant_reply' as const, content: 'hi!', failure: 0 });
    db.append({ session_id: 's1', turn_id: 1, source: 'reasoning' as const, content: 'think...', failure: 0 });
    db.append({ session_id: 's2', turn_id: 1, source: 'user_input' as const, content: 'other', failure: 0 });

    const turns = db.listTurns();
    expect(turns).toHaveLength(2);
    const s1 = turns.find((t) => t.session_id === 's1');
    expect(s1?.has_user_input).toBe(1);
    expect(s1?.response_count).toBe(2); // assistant + reasoning
    expect(s1?.count).toBe(3);
  });

  test('deleteTurn removes only that turn', () => {
    db.append({ session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'a', failure: 0 });
    db.append({ session_id: 's1', turn_id: 2, source: 'user_input' as const, content: 'b', failure: 0 });
    db.append({ session_id: 's1', turn_id: 2, source: 'assistant_reply' as const, content: 'c', failure: 0 });

    expect(db.deleteTurn('s1', 1)).toBe(1);
    const turns = db.listTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].turn_id).toBe(2);
  });

  test('archiveTurn moves observations to t1_archive and removes from t1', () => {
    db.append({ session_id: 's1', turn_id: 1, source: 'user_input' as const, content: 'hello', failure: 0 });
    db.append({ session_id: 's1', turn_id: 1, source: 'assistant_reply' as const, content: 'hi!', failure: 0 });
    db.append({ session_id: 's1', turn_id: 2, source: 'user_input' as const, content: 'world', failure: 0 });

    expect(db.archiveTurn('s1', 1)).toBe(2);
    expect(db.count()).toBe(1); // only turn 2 remains
    expect(db.archiveCount()).toBe(2);

    const archived = db.readArchiveTurn('s1', 1);
    expect(archived).toHaveLength(2);
    expect(archived[0].content).toBe('hello');
    expect(archived[1].content).toBe('hi!');

    const archiveTurns = db.listArchiveTurns();
    expect(archiveTurns).toHaveLength(1);
    expect(archiveTurns[0].turn_id).toBe(1);
  });

  test('logNoop and listNoops', () => {
    db.logNoop('s1', 1, 'routine status update');
    db.logNoop('s1', 2, 'trivial content');
    db.logNoop('s2', 1, 'no durable facts');

    const all = db.listNoops();
    expect(all).toHaveLength(3);

    const s1 = db.listNoops({ session_id: 's1' });
    expect(s1).toHaveLength(2);

    const limited = db.listNoops({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  test('reasoning full text is stored unmodified', () => {
    const long = 'x'.repeat(50_000);
    db.append({ session_id: 's1', turn_id: 1, source: 'reasoning' as const, content: long, failure: 0 });
    const rows = db.readTurn('s1', 1);
    expect(rows[0].content).toBe(long);
  });
});
