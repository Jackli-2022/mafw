import { SessionWorkerPool } from '../../../gateway/src/recall/session-worker-pool';

describe('SessionWorkerPool', () => {
  let fakeClient: any;
  let pool: SessionWorkerPool;

  beforeEach(() => {
    fakeClient = {
      session: {
        create: jest.fn().mockImplementation(async () => ({ data: { id: 'w' } })),
        prompt: jest.fn().mockResolvedValue({ data: { parts: [{ type: 'text', text: 'ok' }] } }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    pool = new SessionWorkerPool({ client: fakeClient, directory: '/tmp', ttlMs: 60_000 });
  });

  test('lazily creates distinct extract/reflect workers per session', () => {
    const e1 = pool.getWorker('s1', 'extract');
    const r1 = pool.getWorker('s1', 'reflect');
    expect(e1).not.toBe(r1);
    // reuse for the same key
    expect(pool.getWorker('s1', 'extract')).toBe(e1);
    // distinct session → distinct workers
    expect(pool.getWorker('s2', 'extract')).not.toBe(e1);
    expect(pool.size()).toBe(2);
    // no opencode session is created until a prompt actually runs
    expect(fakeClient.session.create).not.toHaveBeenCalled();
  });

  test('evicts and disposes workers after TTL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const e = pool.getWorker('s1', 'extract');
    await e.prompt('x'); // creates the underlying session
    expect(fakeClient.session.create).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(61_000);
    pool.getWorker('s2', 'extract'); // expired s1 entry dropped → onEvict disposes
    await jest.advanceTimersByTimeAsync(0); // let the fire-and-forget dispose settle
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('access touches the TTL (active sessions survive)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    pool.getWorker('s1', 'extract');
    jest.advanceTimersByTime(50_000);
    expect(pool.getWorker('s1', 'extract')).toBeDefined(); // touch
    jest.advanceTimersByTime(50_000);
    expect(pool.getWorker('s1', 'extract')).toBeDefined(); // still alive
    jest.useRealTimers();
  });

  test('runExclusive serializes concurrent runs per (session, kind)', async () => {
    let running = 0;
    let maxRunning = 0;
    const fn = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    };
    const p1 = pool.runExclusive('s1', 'reflect', fn);
    const p2 = pool.runExclusive('s1', 'reflect', fn); // joins p1
    await Promise.all([p1, p2]);
    expect(maxRunning).toBe(1);
  });

  test('runExclusive allows parallel runs across different sessions', async () => {
    let running = 0;
    let maxRunning = 0;
    const fn = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    };
    await Promise.all([
      pool.runExclusive('s1', 'reflect', fn),
      pool.runExclusive('s2', 'reflect', fn),
    ]);
    expect(maxRunning).toBe(2);
  });

  test('hard cap evicts the oldest session', async () => {
    const capped = new SessionWorkerPool({ client: fakeClient, directory: '/tmp', ttlMs: 60_000, maxSessions: 2 });
    await capped.getWorker('s1', 'extract').prompt('x');
    await capped.getWorker('s2', 'extract').prompt('x');
    await capped.getWorker('s3', 'extract').prompt('x'); // evicts s1
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget dispose settle
    expect(capped.size()).toBe(2);
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(1);
  });

  test('hard cap skips sessions with in-flight workers', async () => {
    const capped = new SessionWorkerPool({ client: fakeClient, directory: '/tmp', ttlMs: 60_000, maxSessions: 2 });
    await capped.getWorker('s1', 'extract').prompt('x');
    await capped.getWorker('s2', 'extract').prompt('x');
    // s1's worker is mid-flight → not evictable
    const hold = new Promise<void>((resolve) => {
      fakeClient.session.prompt.mockImplementationOnce(() => new Promise((r) => setTimeout(() => { resolve(); r({ data: { parts: [] } }); }, 30)));
    });
    const inFlight = capped.runExclusive('s1', 'extract', async () => {
      await capped.getWorker('s1', 'extract').prompt('hold');
    });
    await hold; // prompt in flight now
    capped.getWorker('s3', 'extract'); // overflow: s1 in flight → evicts s2 instead
    expect(capped.size()).toBe(2);
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(1);
    await inFlight;
  });

  test('disposeAll clears everything', async () => {
    await pool.getWorker('s1', 'extract').prompt('x');
    await pool.getWorker('s2', 'reflect').prompt('x');
    await pool.disposeAll();
    expect(fakeClient.session.delete).toHaveBeenCalledTimes(2);
    expect(pool.size()).toBe(0);
  });
});
