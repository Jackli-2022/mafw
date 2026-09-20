// GET /api/sessions/:sid/diff + POST /api/sessions/:sid/diff/revert（deps 注入可单测）。
import { handleSessionDiff, handleSessionDiffRevert, SessionDiffDeps } from '../../../src/routes/session-diff';
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
        vcs: { apply: async (o: any) => { calls.push(['apply', o]); } },
      },
    } as any,
    ...overrides,
  };
  return { deps, calls };
}

describe('GET /api/sessions/:sid/diff', () => {
  it('透传 diff 列表（messageID 可选）', async () => {
    const { deps, calls } = makeDeps();
    const res = makeRes();
    await handleSessionDiff(res, 's1', 'm1', deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ files: FILES });
    expect(calls[0]).toEqual(['diff', { sessionID: 's1', messageID: 'm1' }]);
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
  it('合法 body → buildRevertPatch → vcs.apply', async () => {
    const { deps, calls } = makeDeps();
    const res = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x.txt', patch: FILES[0].patch, hunkIndices: [0] }] }), res, 's1', deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse((res as any).body).reverted).toBe(1);
    expect(calls[0][0]).toBe('apply');
    expect(calls[0][1].patch).toContain('+a');
    expect(calls[0][1].patch).toContain('-b');
  });

  it('非法 body（空 patches / 缺 hunkIndices / hunk 越界）→ 400', async () => {
    const { deps } = makeDeps();
    for (const body of [{}, { patches: [] }, { patches: [{ file: 'x', patch: FILES[0].patch }] }, { patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [99] }] }, { patches: [{ file: 'x', patch: '', hunkIndices: [0] }] }]) {
      const res = makeRes();
      await handleSessionDiffRevert(makeReq(body), res, 's1', deps);
      expect(res.statusCode).toBe(400);
    }
  });

  it('能力缺失 → 503；apply 抛错 → 502', async () => {
    const { deps } = makeDeps({ runtime: { capabilities: {} } as any });
    const res = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [0] }] }), res, 's1', deps);
    expect(res.statusCode).toBe(503);

    const d2 = makeDeps({
      runtime: { capabilities: { diffApi: true }, session: { vcs: { apply: async () => { throw new Error('conflict'); } } } } as any,
    });
    const res2 = makeRes();
    await handleSessionDiffRevert(makeReq({ patches: [{ file: 'x', patch: FILES[0].patch, hunkIndices: [0] }] }), res2, 's1', d2.deps);
    expect(res2.statusCode).toBe(502);
    expect(JSON.parse((res2 as any).body).error).toContain('conflict');
  });
});
