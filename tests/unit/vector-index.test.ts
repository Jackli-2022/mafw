jest.mock('@huggingface/transformers', () => ({
  pipeline: jest.fn()
}));

import { VectorIndex } from '../../gateway/src/core/compression/vector-index';
import { pipeline } from '@huggingface/transformers';
import * as fs from 'fs';
import * as path from 'path';

const mockPipeline = pipeline as jest.Mock;
const TEST_DIR = path.join(__dirname, '../../.test-tmp');

describe('VectorIndex', () => {
  let idx: VectorIndex;

  beforeEach(() => {
    const mockEmbedder = jest.fn().mockImplementation(async (text: string) => {
      const len = 4;
      const data = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        data[i] = text.length * (i + 1) / 10;
      }
      return { data };
    });
    mockPipeline.mockResolvedValue(mockEmbedder);
    idx = new VectorIndex();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('init() lazily loads pipeline', async () => {
    expect(mockPipeline).not.toHaveBeenCalled();
    await idx.init();
    expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    expect((idx as any).initialized).toBe(true);
  });

  test('addDocument() calls embedder and stores vector', async () => {
    await idx.addDocument('doc1', 'hello world', { source: 'test' });
    expect(idx.size).toBe(1);
  });

  test('addDocuments() batch adds', async () => {
    await idx.addDocuments([
      { id: 'doc1', text: 'hello' },
      { id: 'doc2', text: 'world', metadata: { key: 'val' } }
    ]);
    expect(idx.size).toBe(2);
  });

  test('search() computes cosine similarity and returns ranked results', async () => {
    await idx.addDocument('doc1', 'hello world');
    await idx.addDocument('doc2', 'goodbye world');
    const results = await idx.search('hello');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('text');
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('empty index returns empty', async () => {
    const results = await idx.search('hello');
    expect(results).toEqual([]);
  });

  test('save() and load() round-trip', async () => {
    await idx.addDocument('doc1', 'hello world', { key: 'val' });
    const savePath = path.join(TEST_DIR, 'vectors.json');
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
    idx.save(savePath);

    const idx2 = new VectorIndex();
    idx2.load(savePath);
    expect(idx2.size).toBe(1);
    const results = await idx2.search('hello');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
    expect(results[0].metadata).toEqual({ key: 'val' });
  });

  test('removeDocument() works', async () => {
    await idx.addDocument('doc1', 'hello');
    expect(idx.size).toBe(1);
    idx.removeDocument('doc1');
    expect(idx.size).toBe(0);
  });

  test('clear() works', async () => {
    await idx.addDocument('doc1', 'hello');
    await idx.addDocument('doc2', 'world');
    expect(idx.size).toBe(2);
    idx.clear();
    expect(idx.size).toBe(0);
  });

  test('search respects topK parameter', async () => {
    await idx.addDocument('doc1', 'a');
    await idx.addDocument('doc2', 'b');
    await idx.addDocument('doc3', 'c');
    const results = await idx.search('test', 1);
    expect(results).toHaveLength(1);
  });
});
