import { FileStorage } from '../../src/storage/file-storage';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let storage: FileStorage;
let basePath: string;

beforeEach(() => {
  basePath = path.join(os.tmpdir(), `mafw-file-test-${Date.now()}-${Math.random()}`);
  storage = new FileStorage(basePath);
});

afterEach(() => {
  try { fs.rmSync(basePath, { recursive: true, force: true }); } catch { /* ok */ }
});

test('set writes JSON file', async () => {
  await storage.set('test-scope', 'test-key', { foo: 'bar' });
  const filePath = path.join(basePath, 'test-scope', 'test-key.json');
  expect(fs.existsSync(filePath)).toBe(true);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  expect(content).toEqual({ foo: 'bar' });
});

test('get reads JSON file', async () => {
  await storage.set('scope-r', 'key-r', { data: 'read-test' });
  const result = await storage.get('scope-r', 'key-r');
  expect(result).toEqual({ data: 'read-test' });
});

test('get returns null for missing', async () => {
  const result = await storage.get('no-scope', 'no-key');
  expect(result).toBeNull();
});

test('delete removes file', async () => {
  await storage.set('del-scope', 'del-key', { temp: true });
  expect(fs.existsSync(path.join(basePath, 'del-scope', 'del-key.json'))).toBe(true);

  await storage.delete('del-scope', 'del-key');
  expect(fs.existsSync(path.join(basePath, 'del-scope', 'del-key.json'))).toBe(false);
});

test('query returns filtered items', async () => {
  await storage.set('filter-scope', 'item-a', { name: 'alpha', energy: 0.9 });
  await storage.set('filter-scope', 'item-b', { name: 'beta', energy: 0.3 });
  await storage.set('filter-scope', 'item-c', { name: 'gamma', energy: 0.7 });

  const all = await storage.query('filter-scope');
  expect(all).toHaveLength(3);

  const filtered = await storage.query('filter-scope', { energyMin: 0.5 });
  expect(filtered).toHaveLength(2);
  expect(filtered[0].name).toBe('alpha');

  const limited = await storage.query('filter-scope', { limit: 2 });
  expect(limited).toHaveLength(2);
});

test('batch multiple operations', async () => {
  await storage.batch([
    { type: 'set', scope: 'batch', key: 'k1', value: { n: 1 } },
    { type: 'set', scope: 'batch', key: 'k2', value: { n: 2 } },
    { type: 'set', scope: 'batch', key: 'k3', value: { n: 3 } }
  ]);

  expect(await storage.get('batch', 'k1')).toEqual({ n: 1 });
  expect(await storage.get('batch', 'k2')).toEqual({ n: 2 });
  expect(await storage.get('batch', 'k3')).toEqual({ n: 3 });

  await storage.batch([
    { type: 'delete', scope: 'batch', key: 'k1' },
    { type: 'delete', scope: 'batch', key: 'k2' }
  ]);

  expect(await storage.get('batch', 'k1')).toBeNull();
  expect(await storage.get('batch', 'k2')).toBeNull();
  expect(await storage.get('batch', 'k3')).toEqual({ n: 3 });
});
