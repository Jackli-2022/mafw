import { priorKnowledgeFor, priorKnowledgeBlock, replayPriorityForMemory, TurnPipeline, TOOL_EXTRACTION_SYSTEM, capTranscript } from '../../src/recall/turn-pipeline';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, sessionId: string, type = 'semantic'): HarmonicUnit {
  const now = new Date().toISOString();
  return { id, type, primary_abstraction: abstraction, cue_anchors: ['kubernetes', 'deploy'], memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now, source_session_id: sessionId } as HarmonicUnit;
}

describe('priorKnowledgeFor', () => {
  test('召回跨会话相关记忆，排除本会话与 episodic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('a', 'kubernetes deployment rollout steps', 'other-session'), 'semantic');
    index.addEntry(unit('b', 'kubernetes deployment narrative', 'other-session', 'episodic'), 'episodic');
    index.addEntry(unit('c', 'kubernetes deployment current', 's1'), 'semantic');
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 5);
    const ids = out.map(e => e.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('k<=0 或空 query 返回空', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    const index = new HarmonicIndexManager(dir);
    expect(priorKnowledgeFor(index, 's1', 'q', 0)).toEqual([]);
    expect(priorKnowledgeFor(index, 's1', '  ', 5)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('priorKnowledgeBlock', () => {
  test('渲染 id + 摘要，超预算截断', () => {
    const entries = [
      { id: 'm1', primary_abstraction: 'first' },
      { id: 'm2', primary_abstraction: 'second' },
    ] as any;
    const block = priorKnowledgeBlock(entries, 1000);
    expect(block).toContain('m1');
    expect(block).toContain('reconcile');
    const tiny = priorKnowledgeBlock(entries, 12);
    expect(tiny === '' || (tiny.includes('m1') && !tiny.includes('m2'))).toBe(true);
  });

  test('空数组返回空串', () => {
    expect(priorKnowledgeBlock([], 1000)).toBe('');
  });
});

describe('TurnPipeline replay injection', () => {
  test('runSession prompt 含跨会话 prior knowledge 块', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-int-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('other', 'kubernetes deployment prior decision', 'other-session'), 'semantic');

    let captured = '';
    const fakeWorker = { prompt: async (p: string) => { captured = p; return '[NOOP: test]'; } };
    const fakeDb = {
      listTurns: () => [{ session_id: 's1', turn_id: 1, count: 2, has_user_input: 1, response_count: 1, last_ts: 0 }],
      readTurn: () => [{ source: 'user_input', content: 'kubernetes deployment question' }],
      archiveTurn: () => {},
      logNoop: () => {},
    } as any;

    const pipeline = new TurnPipeline({
      t1db: fakeDb,
      index,
      workerFor: () => fakeWorker as any,
      staleMs: 0,
      replayK: 5,
      replayMaxChars: 1500,
    });
    await pipeline.runSession('s1');
    expect(captured).toContain('Prior knowledge from other work');
    expect(captured).toContain('[other]');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('TOOL_EXTRACTION_SYSTEM 含 reconcile 指令', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toContain('Prior knowledge from other work');
  });
});

describe('capTranscript', () => {
  test('超预算截断并加标记', () => {
    const capped = capTranscript('x'.repeat(100), 50);
    expect(capped).toContain('truncated');
    expect(capped.length).toBeLessThanOrEqual(50 + 60);
  });
  test('未超预算原样返回', () => {
    expect(capTranscript('short', 100)).toBe('short');
  });
});

describe('B1 need-driven replay sampling', () => {
  test('replayPriorityForMemory: need boosts, high energy dampens', () => {
    const base = { id: 'a', energy: 0.8, salience: 1 };
    expect(replayPriorityForMemory(base, 5)).toBeGreaterThan(replayPriorityForMemory(base, 0));
    expect(replayPriorityForMemory({ ...base, energy: 0.3 }, 0)).toBeGreaterThan(replayPriorityForMemory(base, 0));
  });

  test('priorKnowledgeFor re-ranks BM25 candidates by need×gain×1/energy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-need-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    const mk = (id: string, abstr: string, energy: number) => {
      const u = unit(id, abstr, 'other-session');
      (u as any).energy = energy;
      index.addEntry(u, 'semantic');
    };
    mk('hot', 'kubernetes deployment alpha details', 0.95); // BM25 winner, no need
    mk('needed', 'kubernetes deployment beta', 0.4);        // weaker, but heavily needed
    const needFor = (id: string) => (id === 'needed' ? 6 : 0);
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 1, { needFor });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('needed');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('excludes entries replayed within the window; backfills when the pool is exhausted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-excl-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    const u1 = unit('recent', 'kubernetes deployment recent', 'other-session');
    const u2 = unit('fresh', 'kubernetes deployment fresh', 'other-session');
    index.addEntry(u1, 'semantic');
    index.addEntry(u2, 'semantic');
    const now = Date.now();
    index.getIndex().entries.find((e: any) => e.id === 'recent')!.last_replayed = new Date(now - 3600_000).toISOString();

    // Window excludes 'recent' → only 'fresh' comes back.
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 2, { now });
    expect(out.map((e) => e.id)).toEqual(['fresh']);

    // Pool fully exhausted (EVERYTHING recently replayed) → backfill rather
    // than an empty prior block.
    index.getIndex().entries.find((e: any) => e.id === 'fresh')!.last_replayed = new Date(now - 1800_000).toISOString();
    const back = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 5, { now });
    expect(back.length).toBeGreaterThan(0);
    expect(back.map((e) => e.id)).toContain('recent');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no opts → legacy BM25 order with no exclusion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-legacy-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('r', 'kubernetes deployment recent', 'other-session'), 'semantic');
    index.getIndex().entries[0].last_replayed = new Date(Date.now() - 1000).toISOString();
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 5);
    expect(out.map((e) => e.id)).toContain('r'); // not excluded in legacy mode
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('runSession stamps last_replayed on the selected prior entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-stamp-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('prior', 'kubernetes deployment prior decision', 'other-session'), 'semantic');

    const fakeWorker = { prompt: async () => '[NOOP: test]' };
    const fakeDb = {
      listTurns: () => [{ session_id: 's1', turn_id: 1, count: 2, has_user_input: 1, response_count: 1, last_ts: 0 }],
      readTurn: () => [{ source: 'user_input', content: 'kubernetes deployment question' }],
      archiveTurn: () => {},
      logNoop: () => {},
    } as any;

    const pipeline = new TurnPipeline({
      t1db: fakeDb,
      index,
      workerFor: () => fakeWorker as any,
      staleMs: 0,
      replayK: 5,
      replayMaxChars: 1500,
      needFor: () => 0,
    });
    await pipeline.runSession('s1');
    const stamped = index.getIndex().entries.find((e: any) => e.id === 'prior');
    expect(stamped?.last_replayed).toBeDefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('S2 replay sampling + schema interleave', () => {  test('prompt interleaves a schema block for a related cluster', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-int-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    let captured = '';
    const fakeWorker = { prompt: async (p: string) => { captured = p; return '[NOOP: test]'; } };
    const fakeDb = {
      listTurns: () => [{ session_id: 's1', turn_id: 1, count: 2, has_user_input: 1, response_count: 1, last_ts: 0 }],
      readTurn: () => [{ source: 'user_input', content: 'deployed', salience: 0.9 }],
      archiveTurn: () => {},
      logNoop: () => {},
    } as any;
    const clusters = [{ id: 'c1', centroid: [1, 0], members: ['rep'], representative: 'rep' }];
    const pipeline = new TurnPipeline({
      t1db: fakeDb,
      index,
      workerFor: () => fakeWorker as any,
      staleMs: 0,
      schemaClusters: () => clusters,
      clusterVector: () => [1, 0],
    });
    await pipeline.runSession('s1');
    expect(captured).toContain('[schema:c1]');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no schema providers → no schema block (rollback-safe)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-none-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    let captured = '';
    const fakeWorker = { prompt: async (p: string) => { captured = p; return '[NOOP: test]'; } };
    const fakeDb = {
      listTurns: () => [{ session_id: 's1', turn_id: 1, count: 1, has_user_input: 1, response_count: 0, last_ts: 0 }],
      readTurn: () => [{ source: 'user_input', content: 'x', salience: 0.5 }],
      archiveTurn: () => {},
      logNoop: () => {},
    } as any;
    const pipeline = new TurnPipeline({ t1db: fakeDb, index, workerFor: () => fakeWorker as any, staleMs: 0 });
    await pipeline.runSession('s1');
    expect(captured).not.toContain('[schema:');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
