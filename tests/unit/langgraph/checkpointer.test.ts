import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileCheckpointer } from '../../../src/langgraph/checkpointer';

describe('FileCheckpointer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves a checkpoint', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const config = { configurable: { thread_id: 'goal-1' } };
    const checkpoint = {
      thread_id: 'goal-1',
      node_id: 'plan',
      ts: new Date().toISOString(),
      state: { round: 1, phase: 'PLANNING' },
    };
    const metadata = { step: 1, retries: 0 };

    await cp.put(config, checkpoint as any, metadata as any);
    const retrieved = await cp.get(config);
    expect(retrieved).toBeDefined();
    expect((retrieved as any).channel_values.round).toBe(1);
  });

  it('returns undefined for nonexistent thread', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const result = await cp.get({ configurable: { thread_id: 'nonexistent' } });
    expect(result).toBeUndefined();
  });

  it('lists checkpoints for a thread', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const config = { configurable: { thread_id: 'goal-2' } };
    await cp.put(config, { thread_id: 'goal-2', node_id: 'plan', ts: '1', state: {} } as any, { step: 1 } as any);
    await cp.put(config, { thread_id: 'goal-2', node_id: 'execute', ts: '2', state: {} } as any, { step: 2 } as any);

    const results: any[] = [];
    for await (const c of cp.list(config)) {
      results.push(c);
    }
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
