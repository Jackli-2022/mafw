/**
 * Task 1: route-layer wiring of recall stage metrics.
 *
 * The boundary route (`GET /api/recall/context`) must feed every stage it
 * owns into `recall-metrics`, record the serving route / snapshot decision,
 * and flag `clientAborted` from `res.destroyed || req.destroyed` — without
 * changing the response body. Retrieval internals are mocked: this suite
 * pins the instrumentation contract, not retrieval quality.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../../../src/config';
import { attachRecallRoutes, type RecallRouteDeps } from '../../../src/routes/recall';
import {
  resetRecallMetricsForTest,
  snapshotRecallMetrics,
} from '../../../src/recall/recall-metrics';
import { RetrievalEventBuffer, setRetrievalEventBufferForTest } from '../../../src/core/memory/retrieval-events';
import * as recallContext from '../../../src/recall/recall-context';
import * as recallSnapshot from '../../../src/recall/recall-snapshot';

jest.mock('../../../src/recall/fok-samples', () => ({
  appendFokEvent: jest.fn(),
}));

jest.mock('../../../src/recall/recall-context', () => ({
  searchRecallMemories: jest.fn(),
  evaluateRecallFokZone: jest.fn(),
  recallNeighbors: jest.fn(),
  withTimeout: jest.fn(async (p: unknown) => p),
}));

jest.mock('../../../src/recall/lexical-support', () => ({
  selectLexicallySupportedCandidates: jest.fn(),
}));

jest.mock('../../../src/recall/exact-evidence', () => ({
  findExactRecallEvidence: jest.fn(),
  applyExactRecallEvidence: jest.fn(),
}));

jest.mock('../../../src/recall/recall-snapshot', () => ({
  // Keep the real constants (the serve-time adapter reads SNAPSHOT_DEFAULTS);
  // only the decision functions are pinned by this suite.
  ...jest.requireActual('../../../src/recall/recall-snapshot'),
  decideSnapshotUse: jest.fn(),
  snapshotContainment: jest.fn(() => 0),
}));

const memory = (id: string, text: string) => ({ id, primary_abstraction: text, energy: 1 });

const search = recallContext.searchRecallMemories as jest.Mock;
const fok = recallContext.evaluateRecallFokZone as jest.Mock;
const neighborsFn = recallContext.recallNeighbors as jest.Mock;
const decideSnapshotUse = recallSnapshot.decideSnapshotUse as jest.Mock;

const lexical = require('../../../src/recall/lexical-support');
const exact = require('../../../src/recall/exact-evidence');
const fokSamples = require('../../../src/recall/fok-samples');

let retrievalBuffer: RetrievalEventBuffer;

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;

function makeHarness(opts: { snapshotValue?: unknown; destroyed?: boolean; url?: string } = {}) {
  const handlers: Record<string, Handler> = {};
  const receipts: any[] = [];
  const registry = {
    attachHandler: (name: string, fn: Handler) => {
      handlers[name] = fn;
    },
  };
  const memoryService = {
    harmonicIndex: { getIndex: () => ({ entries: [] as unknown[] }) },
  };
  const deps = {
    buildInstructionBlocks: async () => ({}) as never,
    instructionSync: () => null,
    memoryService: () => memoryService as never,
    recallCalledBySession: () => new Map<string, number>(),
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as never,
    registeredProjects: () => new Map(),
    mafwDir: () => process.cwd(),
    getGatewayDb: () =>
      ({ kvGet: () => opts.snapshotValue ?? null, recordT1RetrievalEvent: () => undefined }) as never,
    getScanService: () => null,
    saveReceipt: (input: any) => { receipts.push(input); },
  } satisfies RecallRouteDeps;

  attachRecallRoutes(registry as never, deps);

  const res: any = {
    destroyed: opts.destroyed ?? false,
    statusCode: 0,
    headers: undefined as unknown,
    body: undefined as string | undefined,
    writeHead(code: number, headers?: unknown) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(body?: string) {
      this.body = body;
    },
  };
  const req: any = {
    url: opts.url ?? '/api/recall/context?query=hello%20world&sessionID=s1',
    headers: { host: 'localhost' },
    destroyed: false,
  };
  return { handler: handlers['recall.context'], res, req, receipts };
}

// `config.search` is a getter (no setter): snapshot the values and restore
// field-by-field so other suites in this Jest worker see the original config.
const originalSearch = { ...config.search };

beforeAll(() => {
  config.search.fok = { ...config.search.fok, enabled: true };
  config.search.temporalNeighbors = { ...config.search.temporalNeighbors, presentation: true };
  config.search.arbiter = false;
  config.search.boundaryDense = false;
  config.search.snapshot = { ...config.search.snapshot, enabled: false };
});

afterAll(() => {
  Object.assign(config.search, originalSearch);
  setRetrievalEventBufferForTest(null);
});

beforeEach(() => {
  resetRecallMetricsForTest();
  jest.clearAllMocks();
  retrievalBuffer = new RetrievalEventBuffer();
  setRetrievalEventBufferForTest(retrievalBuffer);
  const memories = [memory('mem_aaaaaaaaaa1', 'alpha note')];
  search.mockResolvedValue(memories);
  neighborsFn.mockReturnValue(new Map([['mem_aaaaaaaaaa1', [memory('mem_bbbbbbbbbb2', 'beta note')]]]));
  lexical.selectLexicallySupportedCandidates.mockImplementation((candidates: unknown[]) => ({
    applicable: true,
    supported: candidates,
  }));
  exact.findExactRecallEvidence.mockReturnValue([]);
  exact.applyExactRecallEvidence.mockImplementation(
    (memoriesIn: unknown[], _evidence: unknown, status: string) => ({ memories: memoriesIn, status }),
  );
  decideSnapshotUse.mockReturnValue('no-snapshot');
});

test('fallback path records search/fok/lexical/exact/neighbors/render/total and keeps the body', async () => {
  // Two turns: an inject turn exercises lexical support; a low-confidence
  // turn exercises the exact-evidence rescue. Neither runs in the other.
  fok
    .mockReturnValueOnce({ zone: 'inject', evaluated: true })
    .mockReturnValueOnce({ zone: 'low-confidence', evaluated: true });

  const first = makeHarness();
  await first.handler(first.req, first.res);
  const second = makeHarness();
  await second.handler(second.req, second.res);

  expect(first.res.statusCode).toBe(200);
  expect(Object.keys(JSON.parse(first.res.body!))).toEqual(['pointers']);
  expect(typeof JSON.parse(first.res.body!).pointers).toBe('string');
  // low-confidence turn still renders a body (no silent drop), wrapped by the
  // topic header — instrumentation must not change that.
  expect(JSON.parse(second.res.body!).pointers).toContain('<topic-recall>');

  const snapshot = snapshotRecallMetrics();
  const s = snapshot.stages;
  expect(s.search.count).toBe(2);
  expect(s.fok.count).toBe(2);
  expect(s.lexical.count).toBe(1);
  expect(s.exact.count).toBe(1);
  expect(s.neighbors.count).toBe(2);
  expect(s.render.count).toBe(2);
  expect(s.total.count).toBe(2);

  expect(snapshot.requests.total).toBe(2);
  expect(snapshot.requests.byRoute).toEqual({ snapshot: 0, fallback: 2 });
  // snapshot feature disabled in this suite → no decision is taken/recorded
  expect(snapshot.requests.bySnapshotDecision).toEqual({});
  expect(snapshot.requests.clientAborted).toBe(0);
  expect(snapshot.requests.visibleRate).toBe(1);
});

test('snapshot path records route=snapshot and snapshotDecision=use without running search', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  const snap = {
    builtAt: new Date().toISOString(),
    query: 'hello world',
    block: '- #mem-aaa111 "snapshot body" (E:1)',
    fokStatus: 'inject',
    memories: [memory('mem_aaaaaaaaaa1', 'alpha note')],
    ids: ['mem_aaaaaaaaaa1'],
    t1Hits: [],
    t1Rendered: false,
  };

  try {
    const { handler, req, res } = makeHarness({ snapshotValue: snap });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const snapshot = snapshotRecallMetrics();
    expect(snapshot.requests.byRoute).toEqual({ snapshot: 1, fallback: 0 });
    expect(snapshot.requests.bySnapshotDecision).toEqual({ use: 1 });
    expect(snapshot.stages.search.count).toBe(0);
    expect(snapshot.stages.total.count).toBe(1);
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

test('snapshot-skipped decisions are counted on the fallback route', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('topic-shift');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });

  try {
    const { handler, req, res } = makeHarness({
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'unrelated topic',
        block: 'stale block',
        fokStatus: 'inject',
        ids: ['mem_aaaaaaaaaa1'],
      },
    });
    await handler(req, res);

    const snapshot = snapshotRecallMetrics();
    expect(snapshot.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
    expect(snapshot.requests.bySnapshotDecision).toEqual({ 'topic-shift': 1 });
    // the live fallback served the body instead
    expect(snapshot.stages.search.count).toBe(1);
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

test('a snapshot rejected by its own FOK status records snapshotDecision=fok', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });

  try {
    const { handler, req, res } = makeHarness({
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'hello world',
        block: 'unreliable body',
        fokStatus: 'no-memory',
        ids: ['mem_aaaaaaaaaa1'],
      },
    });
    await handler(req, res);

    const snapshot = snapshotRecallMetrics();
    expect(snapshot.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
    expect(snapshot.requests.bySnapshotDecision).toEqual({ fok: 1 });
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

test('a destroyed response is recorded as clientAborted without affecting the return', async () => {  fok.mockReturnValue({ zone: 'inject', evaluated: true });

  const { handler, req, res } = makeHarness({ destroyed: true });
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toBeDefined();

  const snapshot = snapshotRecallMetrics();
  expect(snapshot.requests.total).toBe(1);
  expect(snapshot.requests.clientAborted).toBe(1);
  expect(snapshot.requests.visible).toBe(0);
  expect(snapshot.requests.visibleRate).toBe(0);
});

test('empty query early return is still counted (visible-rate denominator)', async () => {
  const { handler, req, res } = makeHarness();
  req.url = '/api/recall/context?query=&sessionID=s1';
  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const snapshot = snapshotRecallMetrics();
  expect(snapshot.requests.total).toBe(1);
  expect(snapshot.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
  expect(snapshot.stages.total.count).toBe(1);
});

test('a snapshot with no support for the current query records current-query-filter and runs the live fallback', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });
  // The adapter asks the support selector twice (anchors, then T1 excerpts):
  // nothing in this snapshot is supported by the current query.
  lexical.selectLexicallySupportedCandidates.mockReturnValue({ applicable: true, supported: [] });

  try {
    const { handler, req, res } = makeHarness({
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'memory recall performance window',
        block: '<recall>stale snapshot body</recall>',
        fokStatus: 'inject',
        ids: ['mem_stale000001'],
        memories: [{ id: 'mem_stale000001', abstraction: 'stale gist', cue_anchors: ['stale'] }],
        t1Hits: [],
        t1Rendered: false,
      },
    });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.pointers).not.toContain('stale snapshot body');
    const metrics = snapshotRecallMetrics();
    expect(metrics.requests.bySnapshotDecision).toEqual({ 'current-query-filter': 1 });
    // the fallback route served this turn and the live search really ran
    expect(metrics.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
    expect(search).toHaveBeenCalled();
    expect(metrics.stages.search.count).toBe(1);
    expect(metrics.stages.render.count).toBe(1);
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

test('a throwing adapter falls back to live without recording snapshotDecision=use', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });
  lexical.selectLexicallySupportedCandidates.mockImplementation((candidates: unknown[]) => ({
    applicable: true,
    supported: candidates,
  }));
  const badMemory: any = { id: 'mem_boom000001' };
  Object.defineProperty(badMemory, 'abstraction', {
    enumerable: true,
    configurable: true,
    get() { throw new Error('adapter boom'); },
  });

  try {
    const { handler, req, res } = makeHarness({
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'hello world window',
        block: '<recall>never served</recall>',
        fokStatus: 'inject',
        ids: ['mem_boom000001'],
        memories: [badMemory],
        t1Hits: [],
        t1Rendered: false,
      },
    });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).pointers).not.toContain('never served');
    const metrics = snapshotRecallMetrics();
    // Never "use" for a snapshot that did not render: the pessimistic decision
    // set before the adapter call survives the throw.
    expect(metrics.requests.bySnapshotDecision).toEqual({ 'current-query-filter': 1 });
    expect(metrics.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
    expect(search).toHaveBeenCalled();
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

test('a served snapshot only exposes the current-query-supported block/ids/memories/t1Hits', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });
  lexical.selectLexicallySupportedCandidates
    .mockImplementationOnce((candidates: Array<{ primary_abstraction?: string }>) => ({
      applicable: true,
      supported: candidates.slice(0, 1),
    }))
    .mockReturnValueOnce({ applicable: true, supported: [] });

  try {
    const { handler, req, res, receipts } = makeHarness({
      url: '/api/recall/context?query=hello%20world&sessionID=s1&anchorKey=turn_a',
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'hello world window',
        block: '<recall>two anchors</recall>',
        fokStatus: 'inject',
        top1prob: 0.8,
        ids: ['mem_keep_000001', 'mem_drop_000002'],
        memories: [
          { id: 'mem_keep_000001', abstraction: 'hello alpha' },
          { id: 'mem_drop_000002', abstraction: 'unrelated beta' },
        ],
        t1Hits: [{ sessionId: 's1', turnId: 1, traceId: 't1t_keep', cosine: 0.8, excerpt: 'hello t1' }],
        t1Rendered: true,
      },
    });
    await handler(req, res);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const body = JSON.parse(res.body!);
    expect(body.pointers).toContain('#mem-000001');
    expect(body.pointers).not.toContain('#mem-000002');
    expect(body.pointers).not.toContain('[t1|t1t_keep]');
    // exposure (ACT-R settlement) only for the pointers that were served
    expect(retrievalBuffer.drain().map((e) => e.id)).toEqual(['mem_keep_000001']);
    // FOK hit-proxy sample carries the filtered ids
    expect(fokSamples.appendFokEvent).toHaveBeenCalledWith(expect.objectContaining({ ids: ['mem_keep_000001'] }));
    // receipt mirrors the filtered anchors + T1
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receipt.counts).toEqual({ memories: 1, t1: 0 });
    const metrics = snapshotRecallMetrics();
    expect(metrics.requests.bySnapshotDecision).toEqual({ use: 1 });
    expect(metrics.requests.byRoute).toEqual({ snapshot: 1, fallback: 0 });
    // the adapter/re-render cost lands on the render stage, not search
    expect(metrics.stages.render.count).toBe(1);
    expect(metrics.stages.search.count).toBe(0);
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});
