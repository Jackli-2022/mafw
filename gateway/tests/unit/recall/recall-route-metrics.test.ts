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
import { readFileSync } from 'fs';
import { join } from 'path';
import { Value } from '@sinclair/typebox/value';
import { config } from '../../../src/config';
import { attachRecallRoutes, type RecallRouteDeps } from '../../../src/routes/recall';
import {
  RECALL_STAGE_KEYS,
  resetRecallMetricsForTest,
  snapshotRecallMetrics,
} from '../../../src/recall/recall-metrics';
import { RecallMetricsResponse } from '../../../src/routes/schemas/recall';
import { RetrievalEventBuffer, setRetrievalEventBufferForTest } from '../../../src/core/memory/retrieval-events';
import * as recallContext from '../../../src/recall/recall-context';
import * as recallSnapshot from '../../../src/recall/recall-snapshot';
import * as embeddingRuntime from '../../../src/memory/embedding-runtime';
import { Scheduler } from '../../../src/scheduler';

jest.mock('../../../src/recall/fok-samples', () => ({
  appendFokEvent: jest.fn(),
}));

jest.mock('../../../src/recall/recall-context', () => ({
  searchRecallMemories: jest.fn(),
  evaluateRecallFokZone: jest.fn(),
  recallNeighbors: jest.fn(),
  withTimeout: jest.fn(async (p: unknown) => p),
}));

jest.mock('../../../src/memory/embedding-runtime', () => ({
  computeDenseScores: jest.fn(),
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
const computeDenseScores = embeddingRuntime.computeDenseScores as jest.Mock;

const lexical = require('../../../src/recall/lexical-support');
const exact = require('../../../src/recall/exact-evidence');
const fokSamples = require('../../../src/recall/fok-samples');

let retrievalBuffer: RetrievalEventBuffer;

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;

function makeHarness(opts: {
  snapshotValue?: unknown;
  destroyed?: boolean;
  url?: string;
  /** Task 1: live scheduler handle (the kernel passes one; tests may fake it). */
  scheduler?: () => { enterForeground(): () => void };
  /** Force the handler body to throw before any inner fail-open guard. */
  recallCallsThrow?: boolean;
} = {}) {
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
    recallCalledBySession: () => {
      if (opts.recallCallsThrow) throw new Error('recall bookkeeping boom');
      return new Map<string, number>();
    },
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as never,
    registeredProjects: () => new Map(),
    mafwDir: () => process.cwd(),
    getGatewayDb: () =>
      ({ kvGet: () => opts.snapshotValue ?? null, recordT1RetrievalEvent: () => undefined }) as never,
    getScanService: () => null,
    saveReceipt: (input: any) => { receipts.push(input); },
    ...(opts.scheduler ? { scheduler: opts.scheduler } : {}),
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
  return { handler: handlers['recall.context'], metricsHandler: handlers['recall.metrics'], res, req, receipts };
}

/** Minimal scheduler double: records the acquire/release contract only. */
function fakeScheduler() {
  const releases: Array<jest.Mock> = [];
  const enterForeground = jest.fn(() => {
    const release = jest.fn();
    releases.push(release);
    return release;
  });
  return { scheduler: { enterForeground }, enterForeground, releases };
}

/**
 * Run `fn` while collecting unhandled rejections. Fail-open acquire paths must
 * not leak an exception into the process even though the handler already
 * returned its 200 body.
 */
async function withUnhandledRejectionWatch<T>(fn: () => Promise<T>): Promise<{ result: T; unhandled: unknown[] }> {
  const unhandled: unknown[] = [];
  const onRejection = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onRejection);
  try {
    const result = await fn();
    // Unhandled rejections are reported on a later turn: flush one macrotask.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { result, unhandled };
  } finally {
    process.off('unhandledRejection', onRejection);
  }
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
  computeDenseScores.mockResolvedValue(undefined);
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
    // FOK hit-proxy sample is NOT written: the rolling-window top1prob ranked a
    // different id set than the one actually served, so the join would label
    // that probability with evidence it never earned.
    expect(fokSamples.appendFokEvent).not.toHaveBeenCalled();
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

test('an unfiltered snapshot serve still writes the original-window FOK sample', async () => {
  config.search.snapshot = { ...config.search.snapshot, enabled: true };
  decideSnapshotUse.mockReturnValue('use');
  fok.mockReturnValue({ zone: 'inject', evaluated: true });
  // Every anchor is supported → the adapter serves the stored block verbatim
  // (`kept.filtered === false`). The rolling-window top1prob and the served ids
  // still describe the same ranking, so the calibration sample stays valid.
  lexical.selectLexicallySupportedCandidates.mockImplementation((candidates: unknown[]) => ({
    applicable: true,
    supported: candidates,
  }));

  try {
    const { handler, req, res } = makeHarness({
      snapshotValue: {
        builtAt: new Date().toISOString(),
        query: 'hello world window',
        block: '<recall>both anchors</recall>',
        fokStatus: 'inject',
        top1prob: 0.72,
        ids: ['mem_keep_000001', 'mem_keep_000002'],
        memories: [
          { id: 'mem_keep_000001', abstraction: 'hello alpha' },
          { id: 'mem_keep_000002', abstraction: 'world beta' },
        ],
        t1Hits: [],
        t1Rendered: false,
      },
    });
    await handler(req, res);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(JSON.parse(res.body!).pointers).toContain('both anchors');
    expect(snapshotRecallMetrics().requests.byRoute).toEqual({ snapshot: 1, fallback: 0 });
    expect(fokSamples.appendFokEvent).toHaveBeenCalledTimes(1);
    expect(fokSamples.appendFokEvent).toHaveBeenCalledWith(expect.objectContaining({
      e: 'inj',
      top1prob: 0.72,
      zone: 'inject',
      ids: ['mem_keep_000001', 'mem_keep_000002'],
    }));
  } finally {
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
  }
});

// ── Task 3: search sub-stage instrumentation + read endpoint ──────────────
// The boundary route owns `dense` (computeDenseScores + deadline wait) and
// forwards `recordRecallStage` as the live search observer for graph /
// expansion / scan. `GET /api/recall/metrics` projects the same in-memory
// aggregate as a fresh JSON copy — read-only, no parameters.
describe('recall sub-stage metrics + read endpoint', () => {
  test('live fallback records dense and forwards onStage to search', async () => {
    config.search.boundaryDense = true;
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    computeDenseScores.mockResolvedValue(new Map([['mem_aaaaaaaaaa1', 0.9]]));

    try {
      const { handler, req, res } = makeHarness();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const metrics = snapshotRecallMetrics();
      expect(metrics.stages.dense.count).toBe(1);
      expect(metrics.stages.search.count).toBe(1);
      // dense scores really reached the live search call
      const options = search.mock.calls[0][4];
      expect(options.denseScores).toBeInstanceOf(Map);
      expect(typeof options.onStage).toBe('function');

      // The forwarded observer is the metrics recorder: invoking it fills the
      // sub-stage rings (the real search emits these in graph→expansion→scan).
      options.onStage('graph', 5);
      options.onStage('expansion', 4);
      options.onStage('scan', 2);
      const after = snapshotRecallMetrics();
      expect(after.stages.graph.count).toBe(1);
      expect(after.stages.expansion.count).toBe(1);
      expect(after.stages.scan.count).toBe(1);
    } finally {
      config.search.boundaryDense = false;
    }
  });

  test('a throwing dense computation keeps the body and still records the dense stage', async () => {
    config.search.boundaryDense = true;
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    computeDenseScores.mockRejectedValue(new Error('sidecar busy'));

    try {
      const { handler, req, res } = makeHarness();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(typeof JSON.parse(res.body!).pointers).toBe('string');
      const metrics = snapshotRecallMetrics();
      expect(metrics.stages.dense.count).toBe(1);
      // BM25-only fallback still served
      expect(metrics.stages.search.count).toBe(1);
    } finally {
      config.search.boundaryDense = false;
    }
  });

  test('GET /api/recall/metrics returns a fresh, schema-valid snapshot copy', async () => {
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    const served = makeHarness();
    await served.handler(served.req, served.res);

    const { metricsHandler, req, res } = makeHarness();
    req.url = '/api/recall/metrics';
    await metricsHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(Object.keys(body.stages).sort()).toEqual([...RECALL_STAGE_KEYS].sort());
    expect(body.requests.total).toBe(1);
    expect(body.requests.byRoute).toEqual({ snapshot: 0, fallback: 1 });
    expect(Value.Check(RecallMetricsResponse, body)).toBe(true);

    // Fresh copy: mutating the response cannot reach the internal rings.
    body.stages.search.count = 999;
    body.requests.byRoute.fallback = 999;
    const again = makeHarness();
    await again.metricsHandler(again.req, again.res);
    const againBody = JSON.parse(again.res.body!);
    expect(againBody.stages.search.count).toBe(1);
    expect(againBody.requests.byRoute.fallback).toBe(1);
    // The read endpoint itself recorded no request (read-only projection).
    expect(snapshotRecallMetrics().requests.total).toBe(1);
  });

  test('catalog + generated contract expose recall.metrics', () => {
    const contract = JSON.parse(readFileSync(
      join(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'openapi.json'),
      'utf-8',
    ));
    const op = contract.paths['/api/recall/metrics'].get;
    expect(op.operationId).toBe('recall.metrics');
    expect(op.parameters).toBeUndefined();
    expect(op.requestBody).toBeUndefined();
    const schema = op.responses['200'].content['application/json'].schema;
    expect(schema.properties.stages).toBeDefined();
    expect(schema.properties.requests).toBeDefined();
  });
});

// ── Task 1: external foreground scope ─────────────────────────────────────
// The boundary route runs real foreground work outside `scheduler.submit`
// (dense + BM25 + FOK + render). While that work is in flight, queued
// `defer-to-idle` snapshot/index-scan tasks must not start; every exit path
// (empty query, served body, served snapshot, thrown error) must release.
describe('recall.context scheduler foreground scope', () => {
  test('the scope is held while search runs and released before the handler resolves', async () => {
    const scheduler = new Scheduler();
    let startedDuringSearch = -1;
    let backgroundRuns = 0;
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    search.mockImplementation(async () => {
      // A snapshot refresh queued while the boundary recall is in flight.
      void scheduler.submit(
        { priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
        async () => { backgroundRuns++; },
      );
      startedDuringSearch = backgroundRuns;
      return [memory('mem_aaaaaaaaaa1', 'alpha note')];
    });

    const { handler, req, res } = makeHarness({ scheduler: () => scheduler });
    await handler(req, res);

    expect(startedDuringSearch).toBe(0); // queued behind the request
    expect(backgroundRuns).toBe(1); // released once the response was served
    expect(res.statusCode).toBe(200);
    expect(typeof JSON.parse(res.body!).pointers).toBe('string');
    expect(scheduler.stats().queued).toBe(0);
  });

  test('a served fallback acquires and releases the scope exactly once', async () => {
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    const { scheduler, enterForeground, releases } = fakeScheduler();

    const { handler, req, res } = makeHarness({ scheduler: () => scheduler });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(enterForeground).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  test('an empty-query early return still releases the scope', async () => {
    const { scheduler, enterForeground, releases } = fakeScheduler();

    const { handler, req, res } = makeHarness({
      scheduler: () => scheduler,
      url: '/api/recall/context?query=&sessionID=s1',
    });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(enterForeground).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  test('a served snapshot releases the scope exactly once', async () => {
    config.search.snapshot = { ...config.search.snapshot, enabled: true };
    decideSnapshotUse.mockReturnValue('use');
    const { scheduler, enterForeground, releases } = fakeScheduler();

    try {
      const { handler, req, res } = makeHarness({
        scheduler: () => scheduler,
        snapshotValue: {
          builtAt: new Date().toISOString(),
          query: 'hello world',
          block: '- #mem-aaa111 "snapshot body" (E:1)',
          fokStatus: 'inject',
          memories: [memory('mem_aaaaaaaaaa1', 'alpha note')],
          ids: ['mem_aaaaaaaaaa1'],
          t1Hits: [],
          t1Rendered: false,
        },
      });
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(snapshotRecallMetrics().requests.byRoute).toEqual({ snapshot: 1, fallback: 0 });
      expect(enterForeground).toHaveBeenCalledTimes(1);
      expect(releases).toHaveLength(1);
      expect(releases[0]).toHaveBeenCalledTimes(1);
    } finally {
      config.search.snapshot = { ...config.search.snapshot, enabled: false };
    }
  });

  test('a throwing handler releases the scope before the fail-open response', async () => {
    const { scheduler, enterForeground, releases } = fakeScheduler();

    const { handler, req, res } = makeHarness({
      scheduler: () => scheduler,
      recallCallsThrow: true,
    });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ pointers: null });
    expect(enterForeground).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  test('without a scheduler dep the route keeps its old behavior (no throw, same body)', async () => {
    fok.mockReturnValue({ zone: 'inject', evaluated: true });

    const { handler, req, res } = makeHarness();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(typeof JSON.parse(res.body!).pointers).toBe('string');
  });

  // The acquire path has two independent fail-open guards: the live getter and
  // `enterForeground()` itself. Each must degrade to exactly the no-scheduler
  // behavior — a normal 200 body, the live search still running, and nothing
  // escaping as an unhandled rejection.
  test('a throwing scheduler getter is fail-open: normal body is served and search still runs', async () => {
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    const boom = new Error('scheduler getter boom');
    const scheduler = jest.fn((): { enterForeground(): () => void } => { throw boom; });
    const { handler, req, res } = makeHarness({ scheduler });

    const { unhandled } = await withUnhandledRejectionWatch(async () => handler(req, res));

    expect(scheduler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(typeof body.pointers).toBe('string');
    expect(body.pointers).toContain('#mem-');
    expect(body.pointers).toContain('alpha note');
    expect(search).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });

  test('a throwing enterForeground is fail-open: normal body is served and search still runs', async () => {
    fok.mockReturnValue({ zone: 'inject', evaluated: true });
    const enterForeground = jest.fn((): (() => void) => {
      throw new Error('enterForeground boom');
    });
    const { handler, req, res } = makeHarness({
      scheduler: () => ({ enterForeground }),
    });

    const { unhandled } = await withUnhandledRejectionWatch(async () => handler(req, res));

    expect(enterForeground).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(typeof body.pointers).toBe('string');
    expect(body.pointers).toContain('#mem-');
    expect(body.pointers).toContain('alpha note');
    expect(search).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });
});
