import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initEmbeddingRuntime, setEmbeddingRuntime } from '../../../src/memory/embedding-runtime';

class FakeProvider {
  name = 'fake-embed';
  dims = 4;
  async embed(texts: string[], _kind?: string): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}

describe('initEmbeddingRuntime t1 channel', () => {
  test('provider active → t1Vectors/t1Indexer created with separate file; harmonic channel intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-'));
    const rt = initEmbeddingRuntime({
      baseDir: dir,
      cfg: { provider: 'local', model: 'fake', dimensions: 4 } as any,
      createProviderFn: (() => new FakeProvider() as any) as any,
    });
    expect(rt).toBeTruthy();
    expect(rt!.t1Vectors).toBeTruthy();
    expect(rt!.t1Indexer).toBeTruthy();
    expect(fs.existsSync(path.join(dir, 'memory', 'vectors-t1-fake-embed.json'))).toBe(false);
    rt!.t1Indexer.enqueueText('k1', 'hello verbatim');
    await rt!.t1Indexer.flushQueue();
    expect(rt!.t1Vectors.get('k1')).toEqual([1, 0, 0, 0]);
    expect(fs.existsSync(path.join(dir, 'memory', 'vectors-t1-fake-embed.json'))).toBe(true);
    expect(rt!.vectors).not.toBe(rt!.t1Vectors);
    setEmbeddingRuntime(null);
  });
  test('provider off → null runtime (t1 channel absent too)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-off-'));
    const rt = initEmbeddingRuntime({ baseDir: dir, cfg: { provider: 'off' } as any });
    expect(rt).toBeNull();
  });
  test('scheduleFlush flushes both channels', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-flush-'));
    const rt = initEmbeddingRuntime({
      baseDir: dir,
      cfg: { provider: 'local', model: 'fake', dimensions: 4 } as any,
      createProviderFn: (() => new FakeProvider() as any) as any,
    });
    setEmbeddingRuntime(rt);
    rt!.indexer.enqueueText('h1', 'harmonic text');
    rt!.t1Indexer.enqueueText('t1k', 'verbatim text');
    await rt!.indexer.flushQueue();
    await rt!.t1Indexer.flushQueue();
    expect(rt!.vectors.get('h1')).toEqual([1, 0, 0, 0]);
    expect(rt!.t1Vectors.get('t1k')).toEqual([1, 0, 0, 0]);
    setEmbeddingRuntime(null);
  });
});
