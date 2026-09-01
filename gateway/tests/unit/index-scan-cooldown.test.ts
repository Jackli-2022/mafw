import { IndexScanService } from '../../src/recall/index-scan';

const fakeIndex: any = {
  getIndex: () => ({
    entries: [
      { id: 'aaaaaaaaaaaa', created_at: '2026-01-01', type: 'semantic', primary_abstraction: 'x', cue_anchors: [] },
    ],
  }),
};

type FetchStub = (url: string, init?: any) => Promise<any>;

function makeService(fetchFn: FetchStub): { svc: IndexScanService; calls: { n: number } } {
  const calls = { n: 0 };
  const svc = new IndexScanService(
    fakeIndex,
    { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
    {
      fetchFn: (async (url: string, init?: any) => {
        calls.n++;
        return fetchFn(url, init);
      }) as any,
      apiKey: 'sk-test',
    },
  );
  return { svc, calls };
}

describe('IndexScanService failure cooldown', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('backs off after a failed scan and skips new HTTP calls until cooldown passes', async () => {
    const { svc, calls } = makeService(() => Promise.reject(new Error('HTTP 500: server error')));

    await svc.scan('q1');
    expect(calls.n).toBe(1);

    // within cooldown → skipped instantly, no request churn
    await svc.scan('q2');
    expect(calls.n).toBe(1);

    // cooldown expired → retries
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    await svc.scan('q3');
    expect(calls.n).toBe(2);
    spy.mockRestore();
  });

  it('resets the cooldown after a successful scan', async () => {
    let fail = true;
    const { svc, calls } = makeService(() =>
      fail
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: '{"relevant_ids":["aaaaaaaaaaaa"],"confidence":0.9}' } }],
            }),
          }),
    );

    await svc.scan('q1'); // fails, cooldown armed
    fail = false;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    await svc.scan('q2'); // succeeds after expiry
    spy.mockRestore();
    await svc.scan('q3'); // immediate — must run (streak reset)
    expect(calls.n).toBe(3);
  });

  it('does not arm the cooldown on low-confidence results (healthy no-match)', async () => {
    const { svc, calls } = makeService(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"relevant_ids":[],"confidence":0.0}' } }],
        }),
      }),
    );

    await svc.scan('q1'); // discarded for low confidence — healthy
    await svc.scan('q2'); // must still run
    expect(calls.n).toBe(2);
  });
});
