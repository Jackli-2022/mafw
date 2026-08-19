import { BM25Index } from '../../gateway/src/core/compression/bm25-index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tmpPath(): string {
  return path.join(os.tmpdir(), `bm25-test-${Date.now()}.json`);
}

test('addDocument and search returns results', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'hello world foo bar');
  const results = idx.search('hello');
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe('d1');
  expect(results[0].text).toBe('hello world foo bar');
  expect(results[0].score).toBeGreaterThan(0);
});

test('relevant documents score higher', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'apple banana cherry');
  idx.addDocument('d2', 'apple apple banana');
  const results = idx.search('apple', 2);
  expect(results).toHaveLength(2);
  expect(results[0].id).toBe('d2');
  expect(results[0].score).toBeGreaterThan(results[1].score);
});

test('multiple docs correct ranking', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'the quick brown fox');
  idx.addDocument('d2', 'jumps over the lazy dog');
  idx.addDocument('d3', 'fox fox fox fox fox');
  const results = idx.search('fox', 3);
  expect(results).toHaveLength(2);
  expect(results[0].id).toBe('d3');
});

test('empty index returns empty', () => {
  const idx = new BM25Index();
  const results = idx.search('anything');
  expect(results).toEqual([]);
});

test('removeDocument works', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'hello world');
  idx.addDocument('d2', 'foo bar');
  expect(idx.size).toBe(2);
  idx.removeDocument('d1');
  expect(idx.size).toBe(1);
  const results = idx.search('hello');
  expect(results).toHaveLength(0);
});

test('clear resets index', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'hello');
  expect(idx.size).toBe(1);
  idx.clear();
  expect(idx.size).toBe(0);
  expect(idx.search('hello')).toEqual([]);
});

test('save and load round-trip preserves data', () => {
  const p = tmpPath();
  try {
    const idx = new BM25Index({ k1: 1.5, b: 0.5 });
    idx.addDocument('d1', 'hello world');
    idx.addDocument('d2', 'foo bar baz');
    idx.save(p);

    const loaded = new BM25Index();
    loaded.load(p);
    expect(loaded.size).toBe(2);
    expect((loaded as any).k1).toBe(1.5);
    expect((loaded as any).b).toBe(0.5);

    const results = loaded.search('hello');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('d1');
  } finally {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
});

test('stemming applies to tokens longer than 5 chars', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'running tests quickly action jumped flies');
  const results = idx.search('running tests');
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe('d1');
  // verification via internal tokenization
  const tokens = (idx as any).tokenize('running tests') as string[];
  // "running" -> remove "ing" -> "runn" -> double consonant reduction -> "run"
  expect(tokens).toContain('run');
  // "tests" (len 5) -> remove "s" -> "test"
  expect(tokens).toContain('test');
});

test('Chinese text mixed with English', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', '这个 BM25 索引 supports 中文和英文混合 text');
  const results = idx.search('中文 索引');
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe('d1');
});

test('custom k1 and b configuration', () => {
  const idx = new BM25Index({ k1: 2.0, b: 0.3 });
  expect((idx as any).k1).toBe(2.0);
  expect((idx as any).b).toBe(0.3);

  idx.addDocument('d1', 'term term term other');
  idx.addDocument('d2', 'term word word word');
  const results = idx.search('term', 2);
  expect(results).toHaveLength(2);
  // d1 has higher tf for "term", so it should rank first
  expect(results[0].id).toBe('d1');
});

test('size property returns document count', () => {
  const idx = new BM25Index();
  expect(idx.size).toBe(0);
  idx.addDocument('d1', 'hello');
  expect(idx.size).toBe(1);
  idx.addDocument('d2', 'world');
  expect(idx.size).toBe(2);
});

test('remove non-existent document does not throw', () => {
  const idx = new BM25Index();
  idx.addDocument('d1', 'hello');
  expect(() => idx.removeDocument('nonexistent')).not.toThrow();
  expect(idx.size).toBe(1);
});
