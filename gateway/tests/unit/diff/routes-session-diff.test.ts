// GET /api/sessions/:sid/diff + POST /api/sessions/:sid/diff/revert（deps 注入可单测）。
import { handleSessionDiff, handleSessionDiffRevert, SessionDiffDeps } from '../../../src/routes/session-diff';
import { TurnDiffUnavailableError } from '../../../src/core/diff/turn-diff';
import { ServerResponse, IncomingMessage } from 'http';
import { EventEmitter } from 'events';

function makeRes() {
  const res = new EventEmitter() as any as ServerResponse;
  (res as any).writeHead = (status: number) => { (res as any).statusCode = status; return res; };
  (res as any).end = (body?: any) => { (res as any).body = body; };
  return res as any as ServerResponse & { statusCode: number; body?: string };
}

function makeReq(body: any): IncomingMessage {
  const req = new EventEmitter() as any as IncomingMessage;
  process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
}

const FILES = [{ file: 'x.txt', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 }];

function makeDeps(overrides: Partial<SessionDiffDeps> = {}) {
  const calls: any[] = [];
  const deps: SessionDiffDeps = {
    runtime: {
      capabilities: { diffApi: true },
      session: {
        diff: async (o: any) => { calls.push(['diff', o]); return FILES; },
        get: async (o: any) => { calls.push(['get', o]); return { id: 's1', location: { directory: '/tmp/proj' } }; },
      },
    } as any,
    applyPatch: async (o: any) => { calls.push(['apply', o]); return { code: 0, stderr: '' }; },
    ...overrides,
  };
  return { deps, calls };
}

describe('GET /api/sessions/:sid/diff', () => {
  it('messageID goes to per-turn diff and never calls session.diff', async () => {
    const { deps, calls } = makeDeps();
    const turnCalls: any[] = [];
    deps.turnDiff = async (a) => { turnCalls.push(a); return FILES; };
    const res = makeRes();
    await handleSessionDiff(res, 's1', 'm1', deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ files: FILES });
    expect(turnCalls).toEqual([{ runtime: deps.runtime, sessionID: 's1', messageID: 'm1' }]);
    expect(calls.some((c) => c[0] === 'diff')).toBe(false);
  });

  it('blank messageID does not fall back to session-wide diff', async () => {
    const { deps, calls } = makeDeps();
    const turnCalls: any[] = [];
    deps.turnDiff = async (a) => {
      turnCalls.push(a);
      throw new TurnDiffUnavailableError('per-turn diff unavailable: user message  not found');
    };
    const res = makeRes();
    await handleSessionDiff(res, 's1', '', deps);
    expect(res.statusCode).toBe(404);
    expect(turnCalls).toHaveLength(1);
    expect(calls.some((c) => c[0] === 'diff')).toBe(false);
  });

  it('no messageID still calls the session-wide runtime diff', async () => {
    const { deps, calls } = makeDeps();
    const res = makeRes();
    await handleSessionDiff(res, 's1', undefined, deps);
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toEqual(['diff', { sessionID: 's1' }]);
  });

  it('maps unavailable to 404 and git/other errors to 502', async () => {
    const unavailable = makeDeps();
    unavailable.deps.turnDiff = async () => { throw new TurnDiffUnavailableError('per-turn diff unavailable: no snapshots'); };
    const r1 = makeRes();
    await handleSessionDiff(r1, 's1', 'm1', unavailable.deps);
    expect(r1.statusCode).toBe(404);

    const failed = makeDeps();
    failed.deps.turnDiff = async () => { throw new Error('git failed'); };
    const r2 = makeRes();
    await handleSessionDiff(r2, 's1', 'm1', failed.deps);
    expect(r2.statusCode).toBe(502);
    expect(JSON.parse((r2 as any).body).error).toContain('git failed');
  });

  it('diffApi 能力缺失 → 503', async () => {
    const { deps } = makeDeps({ runtime: { capabilities: {} } as any });
    const res = makeRes();
    await handleSessionDiff(res, 's1', undefined, deps);
    expect(res.statusCode).toBe(503);
  });

  it('runtime diff 抛错 → 502', async () => {
    const { deps } = makeDeps({
      runtime: { capabilities: { diffApi: true }, session: { diff: async () => { throw new Error('serve down'); } } } as any,
    });
    const res = makeRes();
    await handleSessionDiff(res, 's1', undefined, deps);
    expect(res.statusCode).toBe(502);
  });
});

describe('POST /api/sessions/:sid/diff/revert', () => {
  it('合法 body → buildRevertPatch → gateway-side git apply（带 session 目录）', async () => {
    const { deps, calls } = makeDeps();
    const res = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x.txt', patch: FILES[0].patch, hunkIndices: [0] }] }), res, 's1', deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).reverted).toBe(1);
    const apply = calls.find((c) => c[0] === 'apply');
    expect(apply[1].projectDir).toBe('/tmp/proj');
    expect(apply[1].patch).toContain('+a');
    expect(apply[1].patch).toContain('-b');
  });

  it('非法 body（空 patches / 缺 hunkIndices / hunk 越界）→ 400', async () => {
    const { deps } = makeDeps();
    for (const body of [{}, { patches: [] }, { patches: [{ file: 'x', patch: FILES[0].patch }] }, { patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [99] }] }, { patches: [{ file: 'x', patch: '', hunkIndices: [0] }] }]) {
      const res = makeRes();
      await handleSessionDiffRevert(makeReq(body), res, 's1', deps);
      expect(res.statusCode).toBe(400);
    }
  });

  it('能力缺失 → 503；apply 失败 → 502；目录缺失 → 400', async () => {
    const { deps } = makeDeps({ runtime: { capabilities: {} } as any });
    const res = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [0] }] }), res, 's1', deps);
    expect(res.statusCode).toBe(503);

    const d2 = makeDeps({
      applyPatch: async () => ({ code: 1, stderr: 'patch does not apply' }),
    });
    const res2 = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [0] }] }), res2, 's1', d2.deps);
    expect(res2.statusCode).toBe(502);
    expect(JSON.parse((res2 as any).body).error).toContain('patch does not apply');

    const d3 = makeDeps({
      runtime: {
        capabilities: { diffApi: true },
        session: { get: async () => ({ id: 's1' }) },
      } as any,
    });
    const res3 = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [0] }] }), res3, 's1', d3.deps);
    expect(res3.statusCode).toBe(400);
  });
});
