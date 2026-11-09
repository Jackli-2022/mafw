import { Singleflight } from '../../../src/concurrency/singleflight';

describe('Singleflight', () => {
  it('concurrent calls to same key execute fn once and share result', async () => {
    const sf = new Singleflight();
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return `result-${calls}`;
    };

    const [a, b, c] = await Promise.all([
      sf.run('key', fn),
      sf.run('key', fn),
      sf.run('key', fn),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe('result-1');
    expect(b).toBe('result-1');
    expect(c).toBe('result-1');
  });

  it('different keys execute in parallel', async () => {
    const sf = new Singleflight();
    let calls = 0;
    const fn = async (key: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return key;
    };

    const [a, b] = await Promise.all([
      sf.run('key1', () => fn('key1')),
      sf.run('key2', () => fn('key2')),
    ]);

    expect(calls).toBe(2);
    expect(a).toBe('key1');
    expect(b).toBe('key2');
  });

  it('sequential calls to same key both execute (entry cleaned after first)', async () => {
    const sf = new Singleflight();
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    const first = await sf.run('key', fn);
    const second = await sf.run('key', fn);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it('callers waiting on the same promise all get the same resolved value', async () => {
    const sf = new Singleflight();
    const fn = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { shared: true };
    };

    const [a, b] = await Promise.all([
      sf.run('key', fn),
      sf.run('key', fn),
    ]);

    expect(a).toBe(b);
    expect(a.shared).toBe(true);
  });

  it('if fn rejects, all callers get the rejection, and next call retries', async () => {
    const sf = new Singleflight();
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error(`fail-${calls}`);
    };
    const succeeding = async () => {
      calls++;
      return `ok-${calls}`;
    };

    await expect(Promise.all([
      sf.run('key', failing).catch((e) => e.message),
      sf.run('key', failing).catch((e) => e.message),
    ])).resolves.toEqual(['fail-1', 'fail-1']);

    const result = await sf.run('key', succeeding);
    expect(result).toBe('ok-2');
  });

  it('size reflects number of in-flight keys', async () => {
    const sf = new Singleflight();
    const slow = () => new Promise<string>((r) => setTimeout(() => r('slow'), 60));

    const p1 = sf.run('key1', slow);
    expect(sf.size).toBe(1);

    const p2 = sf.run('key2', slow);
    expect(sf.size).toBe(2);

    // same key doesn't add
    const p3 = sf.run('key1', slow);
    expect(sf.size).toBe(2);

    await Promise.all([p1, p2, p3]);
    expect(sf.size).toBe(0);
  });
});
