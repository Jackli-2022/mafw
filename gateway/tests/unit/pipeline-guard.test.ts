import { PipelineGuard } from '../../src/recall/pipeline-guard';

describe('PipelineGuard', () => {
  test('按名隔离：一个 key 在飞不影响另一个 key', async () => {
    const g = new PipelineGuard({ timeoutMs: 1000 });
    let resolveA: (() => void) | undefined;
    const a = g.run('A', () => new Promise<void>((r) => { resolveA = r; }));
    const b = await g.run('B', async () => { /* completes */ });
    expect(b).toBe('ran');
    resolveA!();
    expect(await a).toBe('ran');
  });

  test('同名在飞则跳过', async () => {
    const g = new PipelineGuard({ timeoutMs: 1000 });
    let resolveA: (() => void) | undefined;
    const a = g.run('A', () => new Promise<void>((r) => { resolveA = r; }));
    const b = await g.run('A', async () => { /* skipped */ });
    expect(b).toBe('skipped');
    resolveA!();
    await a;
  });

  test('超时释放守卫并返回 timeout，之后可再次运行', async () => {
    const g = new PipelineGuard({ timeoutMs: 30 });
    const r = await g.run('A', () => new Promise<void>(() => { /* never resolves */ }));
    expect(r).toBe('timeout');
    expect(g.size).toBe(0);
    expect(await g.run('A', async () => { /* ok */ })).toBe('ran');
  });

  test('fn 抛错时释放守卫并返回 error', async () => {
    const g = new PipelineGuard({ timeoutMs: 1000 });
    const r = await g.run('A', async () => { throw new Error('boom'); });
    expect(r).toBe('error');
    expect(g.size).toBe(0);
  });
});
