import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicIndexManager } from '../../../src/memory/harmonic-index';
import { GuidedRetriever } from '../../../gateway/src/retrieval/guided-retriever';

describe('GuidedRetriever', () => {
  let tmpDir: string;
  let indexManager: HarmonicIndexManager;
  let retriever: GuidedRetriever;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    indexManager = new HarmonicIndexManager(tmpDir);
    indexManager.addEntry({ id: 'm1', type: 'semantic', primary_abstraction: 'payment create order', cue_anchors: ['payment', 'create'], tier: 'knowledge', energy: 0.8 } as any, 'knowledge');
    indexManager.addEntry({ id: 'm2', type: 'semantic', primary_abstraction: 'refund process', cue_anchors: ['refund', 'payment'], tier: 'knowledge', energy: 0.6 } as any, 'knowledge');
    indexManager.addEntry({ id: 'm3', type: 'semantic', primary_abstraction: 'user login flow', cue_anchors: ['login', 'auth'], tier: 'knowledge', energy: 0.7 } as any, 'knowledge');
    retriever = new GuidedRetriever(indexManager);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns results matching query', async () => {
    const results = await retriever.search('payment');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('m1');
  });

  test('returns empty for non-matching query', async () => {
    const results = await retriever.search('zzz');
    expect(results.length).toBe(0);
  });

  test('oneshot policy returns results', async () => {
    const results = await retriever.search('payment', { policy: 'oneshot' });
    expect(results.length).toBeGreaterThan(0);
  });

  test('results are sorted by score descending', async () => {
    const results = await retriever.search('payment');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
