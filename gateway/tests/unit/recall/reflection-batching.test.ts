import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline } from '../../../src/recall/reflection';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { ReflectCursor } from '../../../src/recall/reflect-cursor';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { config } from '../../../src/config';

async function setup(count: number, opts: { batchSize?: number; failOn?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-refl-batch-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const store = new HarmonicUnitFileStore(dir, index);
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `ep${i}`;
    ids.push(id);
    await store.write({
      id, type: 'episodic', primary_abstraction: `EP${i} event`,
      cue_anchors: ['ep'], memory_value: `EP${i} body`,
      energy: 0.8, created_at: now, updated_at: now, source_session_id: 's1',
    } as any, 'episodic');
  }

  const prompts: Array<{ prompt: string; system: string }> = [];
  const worker = {
    prompt: async (prompt: string, system: string) => {
      prompts.push({ prompt, system });
      if (opts.failOn && prompt.includes(opts.failOn)) throw new Error('batch worker down');
      if (system.includes('salient high-level questions')) return JSON.stringify({ questions: [] });
      return JSON.stringify({ insights: [{ category: 'insight', content: `insight ${prompts.length}`, cue_anchors: ['ep'] }] });
    },
  };
  const db = new GatewayDatabase(path.join(dir, 'db.sqlite'));
  const cursor = new ReflectCursor(db);
  const pipe = new ReflectionPipeline({
    index, baseDir: dir, workerFor: () => worker as any, cursor,
    reflectionBatchSize: opts.batchSize ?? 10,
  });
  return { dir, index, db, cursor, pipe, prompts, ids };
}

describe('reflection small-step batching', () => {
  test('chunks episodes and aggregates counts', async () => {
    const { dir, db, cursor, pipe, prompts, ids } = await setup(5, { batchSize: 2 });
    const res = await pipe.runSession('s1');

    const distillPrompts = prompts.filter((p) => p.system.includes('distill durable'));
    expect(distillPrompts).toHaveLength(3); // batches: 2 + 2 + 1
    expect(res.reviewed).toBe(5);
    expect(res.sessions).toBe(1);
    for (const id of ids) expect(cursor.isReflected('s1', id)).toBe(true);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a failed batch does not mark its episodes but later batches still run', async () => {
    const { dir, db, cursor, pipe } = await setup(5, { batchSize: 2, failOn: 'EP3' });
    const res = await pipe.runSession('s1');

    expect(res.reviewed).toBe(5);
    expect(res.failed).toBeGreaterThan(0);
    // batch 1 (EP1/EP2) and batch 3 (EP5) processed; batch 2 (EP3/EP4) remains pending.
    expect(cursor.isReflected('s1', 'ep1')).toBe(true);
    expect(cursor.isReflected('s1', 'ep2')).toBe(true);
    expect(cursor.isReflected('s1', 'ep3')).toBe(false);
    expect(cursor.isReflected('s1', 'ep4')).toBe(false);
    expect(cursor.isReflected('s1', 'ep5')).toBe(true);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('config default batch size is 10', () => {
    expect(config.recall.reflectionBatchSize).toBe(10);
  });
});
