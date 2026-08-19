import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store } from '../../gateway/src/core/memory/t1-store';
import { T1ToT2Compressor } from '../../gateway/src/core/memory/t1-to-t2-compressor';
import { CompressionPipeline } from '../../gateway/src/core/compression/compression-pipeline';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../gateway/src/memory/harmonic-file-store';

describe('T1ToT2Compressor', () => {
  let tmpDir: string;
  let t1Store: T1Store;
  let pipeline: CompressionPipeline;
  let index: HarmonicIndexManager;
  let compressor: T1ToT2Compressor;

  beforeEach(async () => {
    // force local compression fallback (a real gateway on :3000 would be
    // queried for /api/llm/compress and hang the test)
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED (test)') }) as unknown as typeof fetch;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't1t2-test-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    t1Store = new T1Store(tmpDir);
    pipeline = new CompressionPipeline({ baseDir: tmpDir });
    index = new HarmonicIndexManager(tmpDir);
    compressor = new T1ToT2Compressor(t1Store, pipeline, index, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compressSession compresses all turns and clears T1', async () => {
    // The pipeline may hit the real /api/llm/compress (10s client timeout)
    // when the gateway is running locally — allow well beyond the default.
    // Simulate a session with 3 turns, each with multiple observations
    const contents = [
      'Tool Bash executed: npm test',
      'Error: JWT validation failed',
      'File modified: src/auth/jwt.ts',
    ];
    for (let turn = 1; turn <= 3; turn++) {
      t1Store.append({ content: 'user prompt ' + turn, source: 'user_input', sessionID: 'sess-1', turnID: turn, timestamp: Date.now() + turn });
      t1Store.append({ content: contents[turn % contents.length] + ' (turn ' + turn + ')', source: 'tool_result', sessionID: 'sess-1', turnID: turn, timestamp: Date.now() + turn + 1 });
      t1Store.append({ content: 'assistant reply for turn ' + turn, source: 'assistant_reply', sessionID: 'sess-1', turnID: turn, timestamp: Date.now() + turn + 2 });
    }

    expect(t1Store.hasSession('sess-1')).toBe(true);

    const result = await compressor.compressSession('sess-1');

    expect(result.readFromT1).toBe(9);
    expect(result.persisted).toBeGreaterThan(0);
    expect(result.sessionID).toBe('sess-1');

    // T1 should be cleared for this session
    expect(t1Store.hasSession('sess-1')).toBe(false);

    // T2 units should be readable via the store
    const store = new HarmonicUnitFileStore(tmpDir);
    const idx = index.getIndex();
    const t2Entries = idx.entries.filter(e => e.id.startsWith('mem_'));
    // MinHash merge may coalesce similar persisted units, so actual entries <= persisted.
    expect(t2Entries.length).toBeGreaterThan(0);
    expect(t2Entries.length).toBeLessThanOrEqual(result.persisted);
    for (const entry of t2Entries) {
      const unit = await store.read(entry.id);
      expect(unit).not.toBeNull();
      expect(unit!.type).toBe('episodic');
      expect(unit!.abstraction_level).toBe(1);
      expect(unit!.id).toMatch(/^mem_/);
    }
  }, 20_000);

  it('stores units in harmonic index', async () => {
    for (let i = 0; i < 3; i++) {
      t1Store.append({ content: `obs ${i}`, sessionID: 'sess-2', turnID: i + 1, timestamp: Date.now() + i });
    }
    const result = await compressor.compressSession('sess-2');
    const idx = index.getIndex();
    expect(idx.entries.length).toBeGreaterThanOrEqual(1);
    expect(idx.entries.length).toBeLessThanOrEqual(result.persisted);
  });

  it('handles multiple compression rounds', async () => {
    for (let i = 0; i < 3; i++) {
      t1Store.append({ content: `batch A turn ${i}`, sessionID: 'sess-a', turnID: i + 1, timestamp: Date.now() + i });
    }
    const result1 = await compressor.compressSession('sess-a');
    expect(result1.persisted).toBeGreaterThan(0);
    expect(t1Store.hasSession('sess-a')).toBe(false);

    for (let i = 0; i < 3; i++) {
      t1Store.append({ content: `batch B turn ${i}`, sessionID: 'sess-b', turnID: i + 1, timestamp: Date.now() + i + 100 });
    }
    const result2 = await compressor.compressSession('sess-b');
    expect(result2.persisted).toBeGreaterThan(0);
    expect(t1Store.hasSession('sess-b')).toBe(false);

    const store = new HarmonicUnitFileStore(tmpDir);
    const allIds = index.getIndex().entries.filter(e => e.id.startsWith('mem_')).map(e => e.id);
    // MinHash merge can coalesce across sessions; actual ids <= attempted persists.
    expect(allIds.length).toBeGreaterThan(0);
    expect(allIds.length).toBeLessThanOrEqual(result1.persisted + result2.persisted);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('handles empty session gracefully', async () => {
    const result = await compressor.compressSession('nonexistent');
    expect(result.readFromT1).toBe(0);
    expect(result.persisted).toBe(0);
  });

  it('handles different goal separately from session', async () => {
    t1Store.append({ content: 'goal-a obs', sessionID: 'sess-1', goalId: 'goal-a' });
    t1Store.append({ content: 'goal-b obs', sessionID: 'sess-2', goalId: 'goal-b' });
    const result = await compressor.compressSession('sess-1', 'goal-a');
    expect(result.goalId).toBe('goal-a');
    expect(result.readFromT1).toBe(1);
    expect(t1Store.hasSession('sess-2', 'goal-b')).toBe(true);
  });
});
