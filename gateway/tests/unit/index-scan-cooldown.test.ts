import { IndexScanService } from '../../src/recall/index-scan';

const fakeIndex: any = {
  getIndex: () => ({
    entries: [
      { id: 'aaaaaaaaaaaa', created_at: '2026-01-01', type: 'semantic', primary_abstraction: 'x', cue_anchors: [] },
    ],
  }),
};

describe('IndexScanService failure cooldown', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('backs off after a failed scan and skips new workers until cooldown passes', async () => {
    const created = { n: 0 };
    const svc = new IndexScanService(
      fakeIndex,
      () => {
        created.n++;
        return {
          prompt: () => Promise.reject(new Error('index-scan: prompt timed out after 15000ms')),
          dispose: async () => {},
        } as any;
      },
      { providerID: 'x', modelID: 'y' },
    );

    await svc.scan('q1');
    expect(created.n).toBe(1);

    // within cooldown → skipped instantly, no worker churn
    await svc.scan('q2');
    expect(created.n).toBe(1);

    // cooldown expired → retries
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    await svc.scan('q3');
    expect(created.n).toBe(2);
    spy.mockRestore();
  });

  it('resets the cooldown after a successful scan', async () => {
    const created = { n: 0 };
    let fail = true;
    const svc = new IndexScanService(
      fakeIndex,
      () => {
        created.n++;
        return {
          prompt: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve('{"relevant_ids":["aaaaaaaaaaaa"],"confidence":0.9}')),
          dispose: async () => {},
        } as any;
      },
      { providerID: 'x', modelID: 'y' },
    );

    await svc.scan('q1'); // fails, cooldown armed
    fail = false;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    await svc.scan('q2'); // succeeds after expiry
    spy.mockRestore();
    await svc.scan('q3'); // immediate — must run (streak reset)
    expect(created.n).toBe(3);
  });

  it('does not arm the cooldown on low-confidence results (healthy no-match)', async () => {
    const created = { n: 0 };
    const svc = new IndexScanService(
      fakeIndex,
      () => {
        created.n++;
        return {
          prompt: () => Promise.resolve('{"relevant_ids":[],"confidence":0.0}'),
          dispose: async () => {},
        } as any;
      },
      undefined,
    );

    await svc.scan('q1'); // discarded for low confidence — healthy
    await svc.scan('q2'); // must still run
    expect(created.n).toBe(2);
  });
});
