import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SqliteT1VectorStore } from '../../../src/memory/sqlite-vector-store';

describe('SqliteT1VectorStore', () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-vec-'));
    dbPath = path.join(dir, 'gateway.db');
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('roundtrips vectors across reopen and searches by cosine', () => {
    let store = new SqliteT1VectorStore(db, { dims: 3, model: 'm1' });
    store.upsert('a', [1, 0, 0]);
    store.upsert('b', [0.9, 0.1, 0]);
    store.upsert('c', [0, 1, 0]);
    store.flush();
    expect(store.size()).toBe(3);
    expect(Array.from(store.get('a')!)).toEqual([1, 0, 0]);
    expect(store.searchByCosine([1, 0, 0], 2).map((h) => h.id)).toEqual(['a', 'b']);

    db.close();
    db = new Database(dbPath);
    store = new SqliteT1VectorStore(db, { dims: 3, model: 'm1' });
    expect(store.size()).toBe(3);
    expect(store.searchByCosine([0, 1, 0], 1)[0].id).toBe('c');
  });

  test('remove, ids and flush delete rows', () => {
    const store = new SqliteT1VectorStore(db, { dims: 2, model: 'm1' });
    store.upsert('a', [1, 0]);
    store.upsert('b', [0, 1]);
    store.flush();
    store.remove('a');
    expect(store.size()).toBe(1);
    expect(store.ids()).toEqual(['b']);
    store.flush();
    const rows = db.prepare('SELECT key FROM t1_vectors').all() as Array<{ key: string }>;
    expect(rows).toEqual([{ key: 'b' }]);
  });

  test('dimension mismatch is skipped, not thrown', () => {
    const store = new SqliteT1VectorStore(db, { dims: 3, model: 'm1' });
    store.upsert('old', [1, 0]);
    store.flush();
    expect(store.searchByCosine([1, 0, 0], 5)).toEqual([]);
  });

  test('imports a legacy JSON file once and renames it', () => {
    const legacy = path.join(dir, 'vectors-t1-test.json');
    fs.writeFileSync(legacy, JSON.stringify({
      model: 'm1',
      dims: 2,
      vectors: { a: [1, 0], b: [0, 1] },
    }));
    const store = new SqliteT1VectorStore(db, { dims: 2, model: 'm1', legacyJsonPath: legacy });
    expect(store.migrated).toBe(2);
    expect(store.size()).toBe(2);
    expect(store.searchByCosine([1, 0], 1)[0].id).toBe('a');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('vectors-t1-test.json.migrated-'))).toBe(true);

    const again = new SqliteT1VectorStore(db, { dims: 2, model: 'm1', legacyJsonPath: legacy });
    expect(again.migrated).toBe(0);
    expect(again.size()).toBe(2);
  });

  test('corrupt JSON does not throw and leaves the file in place', () => {
    const legacy = path.join(dir, 'vectors-t1-bad.json');
    fs.writeFileSync(legacy, '{not-json');
    const store = new SqliteT1VectorStore(db, { dims: 2, model: 'm1', legacyJsonPath: legacy });
    expect(store.migrated).toBe(0);
    expect(store.size()).toBe(0);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  test('ignores the legacy file when the table already has rows', () => {
    const first = new SqliteT1VectorStore(db, { dims: 2, model: 'm1' });
    first.upsert('existing', [1, 0]);
    first.flush();

    const legacy = path.join(dir, 'vectors-t1-test.json');
    fs.writeFileSync(legacy, JSON.stringify({ dims: 2, vectors: { other: [0, 1] } }));
    const second = new SqliteT1VectorStore(db, { dims: 2, model: 'm1', legacyJsonPath: legacy });
    expect(second.migrated).toBe(0);
    expect(second.size()).toBe(1);
    expect(second.get('other')).toBeUndefined();
    expect(fs.existsSync(legacy)).toBe(true);
  });
});
