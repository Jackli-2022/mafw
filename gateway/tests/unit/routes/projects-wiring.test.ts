// Phase D1 Task A1: /api/projects registry wiring — list filter + current self-heal parity.
// The current-project kv rewrite is load-bearing (repairs polluted entries); pinned here.
import type { IncomingMessage, ServerResponse } from 'http';
import * as os from 'os';
import * as path from 'path';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachProjectRoutes, type RegisteredProjectLike } from '../../../src/routes/projects';

function fakeReq(opts: { url: string; method: string }): IncomingMessage {
  return { method: opts.method, url: opts.url, socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

const RUNTIME_ROOT = path.join(os.homedir(), '.mafw', 'runtime-root');

function project(dir: string): RegisteredProjectLike {
  return { projectDir: dir, mafwDir: path.join(dir, '.mafw'), registeredAt: '2026-01-01T00:00:00.000Z' };
}

function makeDeps(projects: RegisteredProjectLike[], kv: Record<string, string> = {}) {
  const registered = new Map(projects.map((p) => [p.projectDir, p] as const));
  const state = { current: null as string | null };
  const writes: Array<{ scope: string; key: string; value: unknown }> = [];
  return {
    state,
    writes,
    deps: {
      registeredProjects: () => registered,
      currentProjectDir: () => state.current,
      setCurrentProjectDir: (dir: string | null) => { state.current = dir; },
      db: () => ({
        kvGet: <T = string>(scope: string, key: string) => (kv[`${scope}/${key}`] ?? null) as T | null,
        kvSet: (scope: string, key: string, value: unknown) => { writes.push({ scope, key, value }); },
      }),
    },
  };
}

function handlerFor(registry: RouteRegistry, method: string, url: string) {
  return registry.match(method as never, url)?.def.handler;
}

describe('project registry wiring (D1 Task A1)', () => {
  it('catalog routes have handlers attached (no silent 404)', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachProjectRoutes(registry, makeDeps([]).deps);
    expect(handlerFor(registry, 'GET', '/api/projects')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/projects/current')).toBeDefined();
  });

  it('project.list hides the runtime root and maps projectDir → {id,worktree}', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    const a = project(path.join(os.tmpdir(), 'proj-a'));
    const b = project(path.join(os.tmpdir(), 'proj-b'));
    attachProjectRoutes(registry, makeDeps([a, b, project(RUNTIME_ROOT)]).deps);
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/projects')!(fakeReq({ url: '/api/projects', method: 'GET' }), r.res);
    const parsed = JSON.parse(r.body);
    expect(parsed.projects).toEqual([
      { id: a.projectDir, worktree: a.projectDir },
      { id: b.projectDir, worktree: b.projectDir },
    ]);
  });

  it('project.current self-heals a polluted current-project kv (rewrite is load-bearing)', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    const good = project(path.join(os.tmpdir(), 'proj-good'));
    const d = makeDeps([good], { 'current-project/default': RUNTIME_ROOT });
    attachProjectRoutes(registry, d.deps);
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/projects/current')!(fakeReq({ url: '/api/projects/current', method: 'GET' }), r.res);
    expect(JSON.parse(r.body)).toEqual({ project: { id: good.projectDir, worktree: good.projectDir, mafwDir: good.mafwDir } });
    expect(d.state.current).toBe(good.projectDir);
    expect(d.writes).toEqual([{ scope: 'current-project', key: 'default', value: good.projectDir }]);
  });

  it('project.current returns { project: null } when nothing selectable', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachProjectRoutes(registry, makeDeps([]).deps);
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/projects/current')!(fakeReq({ url: '/api/projects/current', method: 'GET' }), r.res);
    expect(JSON.parse(r.body)).toEqual({ project: null });
  });
});
