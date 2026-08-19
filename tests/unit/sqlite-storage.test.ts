import { SQLiteStorage } from '../../gateway/src/core/storage/sqlite-storage';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let storage: SQLiteStorage;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `mafw-test-${Date.now()}-${Math.random()}.db`);
  storage = new SQLiteStorage(dbPath);
});

afterEach(() => {
  storage.close();
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ok */ }
});

test('set and get round-trip', async () => {
  await storage.set('test', 'key1', { hello: 'world', num: 42 });
  const result = await storage.get('test', 'key1');
  expect(result).toEqual({ hello: 'world', num: 42 });
});

test('get returns null for missing key', async () => {
  const result = await storage.get('nosuch', 'missing');
  expect(result).toBeNull();
});

test('delete removes key', async () => {
  await storage.set('test', 'del-key', { data: 'to-delete' });
  await storage.delete('test', 'del-key');
  const result = await storage.get('test', 'del-key');
  expect(result).toBeNull();
});

test('query returns all items in scope', async () => {
  await storage.set('scope-q', 'a', { name: 'alpha' });
  await storage.set('scope-q', 'b', { name: 'beta' });
  await storage.set('scope-q', 'c', { name: 'gamma' });

  const results = await storage.query('scope-q');
  expect(results).toHaveLength(3);
});

test('query with FTS5 search', async () => {
  await storage.set('fts', 'd1', { title: 'The quick brown fox' });
  await storage.set('fts', 'd2', { title: 'jumps over the lazy dog' });
  await storage.set('fts', 'd3', { title: 'The quick brown dog' });

  const results = await storage.query('fts', { query: 'quick' });
  expect(results).toHaveLength(2);

  const dogResults = await storage.query('fts', { query: 'dog' });
  expect(dogResults).toHaveLength(2);
});

test('query with energyMin filter', async () => {
  await storage.set('energy-test', 'low', { text: 'low energy' });
  const lowRow = storage['db'].prepare(
    'UPDATE memories SET energy = ? WHERE key = ?'
  ).run(0.3, 'low');

  await storage.set('energy-test', 'high', { text: 'high energy' });
  const highRow = storage['db'].prepare(
    'UPDATE memories SET energy = ? WHERE key = ?'
  ).run(0.9, 'high');

  const results = await storage.query('energy-test', { energyMin: 0.5 });
  expect(results).toHaveLength(1);
  expect(results[0].text).toBe('high energy');
});

test('query with limit', async () => {
  for (let i = 0; i < 10; i++) {
    await storage.set('limit-scope', `key${i}`, { index: i });
  }

  const results = await storage.query('limit-scope', { limit: 3 });
  expect(results).toHaveLength(3);
});

test('batch atomic write', async () => {
  await storage.batch([
    { type: 'set', scope: 'batch', key: 'k1', value: { v: 1 } },
    { type: 'set', scope: 'batch', key: 'k2', value: { v: 2 } },
    { type: 'set', scope: 'batch', key: 'k3', value: { v: 3 } }
  ]);

  const r1 = await storage.get('batch', 'k1');
  const r2 = await storage.get('batch', 'k2');
  const r3 = await storage.get('batch', 'k3');
  expect(r1).toEqual({ v: 1 });
  expect(r2).toEqual({ v: 2 });
  expect(r3).toEqual({ v: 3 });

  await storage.batch([
    { type: 'delete', scope: 'batch', key: 'k1' },
    { type: 'delete', scope: 'batch', key: 'k2' }
  ]);

  expect(await storage.get('batch', 'k1')).toBeNull();
  expect(await storage.get('batch', 'k2')).toBeNull();
  expect(await storage.get('batch', 'k3')).toEqual({ v: 3 });
});

test('cache returns cached value', async () => {
  await storage.set('cache', 'item', { cached: true });
  const first = await storage.get('cache', 'item');
  expect(first).toEqual({ cached: true });

  storage['db'].prepare('UPDATE memories SET value = ? WHERE key = ?').run('"modified"', 'item');

  const second = await storage.get('cache', 'item');
  expect(second).toEqual({ cached: true });
});

test('cache respects TTL', async () => {
  const shortTTL = new SQLiteStorage(path.join(os.tmpdir(), `mafw-ttl-${Date.now()}.db`), { cacheTTL: 1 });
  try {
    await shortTTL.set('cache-ttl', 'x', { ttl: 'test' });
    expect(await shortTTL.get('cache-ttl', 'x')).toEqual({ ttl: 'test' });

    shortTTL['db'].prepare('UPDATE memories SET value = ? WHERE key = ?').run('"modified"', 'x');

    await new Promise(r => setTimeout(r, 10));

    const result = await shortTTL.get('cache-ttl', 'x');
    expect(result).toEqual('modified');
  } finally {
    shortTTL.close();
  }
});

test('multiple scopes work independently', async () => {
  await storage.set('scope-a', 'shared-key', { owner: 'a' });
  await storage.set('scope-b', 'shared-key', { owner: 'b' });

  const fromA = await storage.get('scope-a', 'shared-key');
  const fromB = await storage.get('scope-b', 'shared-key');

  expect(fromA).toEqual({ owner: 'a' });
  expect(fromB).toEqual({ owner: 'b' });
});
