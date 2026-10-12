import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline, ReflectionOptions } from '../../../src/recall/reflection';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { ReflectCursor } from '../../../src/recall/reflect-cursor';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

class FakeWorker {
  calls = 0;
  async prompt(): Promise<string> {
    this.calls++;
    if (this.calls === 1) return '{"questions":["how does bm25 cache work"]}';
    return JSON.stringify({ insights: [{ category: 'insight', content: 'BM25 tf 词频缓存上线 boundaryDense 否决', cue_anchors: ['bm25', 'cache'] }] });
  }
}

describe('V2 classifyInsight retirement', () => {
  it('insight is NOT pre-skipped by MinHash against a near-verbatim existing entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwr-'));
    try {
      const idx = new HarmonicIndexManager(dir);
      const store = new HarmonicUnitFileStore(dir, idx);
      const now = new Date().toISOString();
      // Pre-existing near-verbatim entry — MinHash classifyInsight would have
      // classified the new insight as duplicate; V2 requires it to reach the
      // judge (routeAndWrite deps unwired here → plain create).
      await store.write({ id: 'existing1', type: 'semantic', primary_abstraction: 'BM25 tf 词频缓存上线 boundaryDense 否决',
        cue_anchors: ['bm25', 'cache'], memory_value: 'BM25 tf 词频缓存上线 boundaryDense 否决',
        energy: 0.8, created_at: now, updated_at: now } as any);
      // Episodic awaiting reflection.
      await store.write({ id: 'ep1', type: 'episodic', primary_abstraction: 'round about bm25 cache',
        cue_anchors: ['bm25'], memory_value: 'we shipped the bm25 token cache', energy: 0.5,
        created_at: now, updated_at: now, source_session_id: 'ses_test' } as any);

      const workers = new Map<string, FakeWorker>();
      const db = new GatewayDatabase(path.join(dir, 'test.db'));
      const opts: ReflectionOptions = {
        index: idx, baseDir: dir,
        workerFor: (sid) => workers.get(sid) ?? (workers.set(sid, new FakeWorker()), workers.get(sid)!),
        cursor: new ReflectCursor(db),
      };
      const pipe = new ReflectionPipeline(opts);
      const res = await pipe.runSession('ses_test');
      db.close();
      expect(res.distilled).toBe(1);
      expect(res.deduped).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
