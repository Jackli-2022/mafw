// Phase D1 Task A5: approvals registry wiring — every scan path kept (project dirs +
// data root + legacy nested goalId/ layout), respond resolves data root first,
// allowlist/rules delegate to their existing modules.
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachApprovalsRoutes } from '../../../src/routes/approvals';

function fakeReq(opts: { url: string; method: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
    get headersSent() { return out.status !== 0; },
  } as unknown as ServerResponse;
  return out;
}

function tmpProject(): { dir: string; mafwDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-approvals-'));
  return { dir, mafwDir: dir };
}

function writeQuestion(mafwDir: string, rel: string, data: Record<string, unknown>) {
  const file = path.join(mafwDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
}

function setup(projects: Array<{ dir: string; mafwDir: string }>) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const allowlist = {
    list: () => [{ tool: 'read' }],
    add: async () => ({ ok: true, entries: [{ tool: 'read' }, { tool: 'write' }] }),
    remove: async () => ({ ok: true, entries: [] }),
  };
  const rules = {
    list: () => [{ tool: 'read', action: 'allow' }],
    add: () => ({ ok: true, rules: [{ tool: 'read', action: 'allow' }] }),
    remove: () => ({ ok: true, rules: [] }),
  };
  attachApprovalsRoutes(registry, {
    registeredProjects: () => new Map(projects.map((p) => [p.dir, { mafwDir: p.mafwDir }] as const)),
    allowlistStore: () => allowlist as any,
    permissionRules: () => rules as any,
  });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url);
    if (!m?.def.handler) return undefined;
    const handler = m.def.handler;
    return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
  };
  return { registry, handlerFor };
}

describe('approvals registry wiring (D1 Task A5)', () => {
  it('all catalog routes have handlers attached (no silent 404)', () => {
    const { handlerFor } = setup([]);
    expect(handlerFor('GET', '/api/approvals')).toBeDefined();
    expect(handlerFor('POST', '/api/approvals/x/respond')).toBeDefined();
    expect(handlerFor('GET', '/api/approvals/allowlist')).toBeDefined();
    expect(handlerFor('POST', '/api/approvals/allowlist')).toBeDefined();
    expect(handlerFor('DELETE', '/api/approvals/allowlist')).toBeDefined();
    expect(handlerFor('GET', '/api/approvals/rules')).toBeDefined();
    expect(handlerFor('POST', '/api/approvals/rules')).toBeDefined();
    expect(handlerFor('DELETE', '/api/approvals/rules')).toBeDefined();
  });

  it('list scans flat + legacy nested project layouts (both id shapes)', async () => {
    const p = tmpProject();
    writeQuestion(p.mafwDir, 'user-questions/flat-1.json', { goalId: 'g1', question: 'Q1', createdAt: 't1' });
    writeQuestion(p.mafwDir, 'user-questions/g2/nested-1.json', { question: 'Q2', answered: true, createdAt: 't2' });
    const { handlerFor } = setup([p]);
    const r = fakeRes();
    await handlerFor('GET', '/api/approvals')!(fakeReq({ url: '/api/approvals', method: 'GET' }), r.res);
    const { approvals } = JSON.parse(r.body);
    expect(approvals).toEqual(expect.arrayContaining([
      { id: 'flat-1', goalId: 'g1', question: 'Q1', status: 'pending', createdAt: 't1' },
      { id: 'nested-1', goalId: 'g2', question: 'Q2', status: 'answered', createdAt: 't2' },
    ]));
  });

  it('list never throws on a broken project dir (fail-open scan)', async () => {
    const p = tmpProject();
    fs.writeFileSync(path.join(p.mafwDir, 'user-questions'), 'not-a-dir', 'utf-8');
    const { handlerFor } = setup([p]);
    const r = fakeRes();
    await handlerFor('GET', '/api/approvals')!(fakeReq({ url: '/api/approvals', method: 'GET' }), r.res);
    // The data-root scan (config.resolvePath()) legitimately contributes entries from
    // the real ~/.mafw — only the broken project must be skipped, without throwing.
    expect(r.status).toBe(200);
    expect(Array.isArray(JSON.parse(r.body).approvals)).toBe(true);
  });

  it('respond writes answered/answer into the resolved question file', async () => {
    const p = tmpProject();
    writeQuestion(p.mafwDir, 'user-questions/q-1.json', { question: 'Q' });
    const { handlerFor } = setup([p]);
    const r = fakeRes();
    await handlerFor('POST', '/api/approvals/q-1/respond')!(
      fakeReq({ url: '/api/approvals/q-1/respond', method: 'POST', body: JSON.stringify({ answer: 'yes' }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', decision: 'answered' });
    expect(JSON.parse(fs.readFileSync(path.join(p.mafwDir, 'user-questions', 'q-1.json'), 'utf-8'))).toMatchObject({ answered: true, answer: 'yes' });
  });

  it('allowlist + rules delegate to their handler modules', async () => {
    const { handlerFor } = setup([]);
    let r = fakeRes();
    await handlerFor('GET', '/api/approvals/allowlist')!(fakeReq({ url: '/api/approvals/allowlist', method: 'GET' }), r.res);
    expect(JSON.parse(r.body)).toEqual({ entries: [{ tool: 'read' }] });

    r = fakeRes();
    await handlerFor('POST', '/api/approvals/rules')!(
      fakeReq({ url: '/api/approvals/rules', method: 'POST', body: JSON.stringify({ tool: 'read' }) }), r.res,
    );
    expect(JSON.parse(r.body).success).toBe(true);

    r = fakeRes();
    await handlerFor('DELETE', '/api/approvals/allowlist')!(
      fakeReq({ url: '/api/approvals/allowlist', method: 'DELETE', body: JSON.stringify({ tool: 'read' }) }), r.res,
    );
    expect(JSON.parse(r.body).success).toBe(true);
  });
});
