// Phase D1 baseline: index.ts's legacy dispatch chain, grouped by path prefix.
// Numbers DECREASED as migration tasks deleted branches. D1 END STATE (Task 9)
// was pinned at 24 (10 match + 14 equals); Phase D3 Task 3 moved the whole HTTP
// transport chain into `src/http/transport.ts` (24 → 5), and D3 Task 4 moved the
// last residue — `handleDashboardAPI` (ruling R5) — into
// `src/subsystems/dashboard-legacy.ts` (5 → 0).
//
// index.ts is therefore route-dispatch free: no `req.url?.` branch at all. The
// moved dispatch is pinned WHERE IT LIVES:
//   - `src/http/transport.ts` — the transport inventory below (Task 3);
//   - `src/subsystems/dashboard-legacy.ts` — the dashboard inventory below
//     (the joint `/api/goals | /api/stats | /api/memory` catch-all that Task 3
//     handed to transport as the `dashboardDispatch` dep).
// Moving a branch again without retargeting these pins fails here.
//
// /api/ws stays out of the HTTP chain entirely (WS upgrade, `http/ws-upgrade.ts`).
// Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

interface Inventory {
  total: number;
  byKind: { match: number; equals: number };
  groups: Array<{ prefix: string; count: number; lines: [number, number] }>;
}

function inventory(): Inventory {
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'analyze-routes.cjs');
  const out = execFileSync('node', [script, '--json'], { encoding: 'utf-8' });
  return JSON.parse(out) as Inventory;
}

const INDEX = path.join(__dirname, '..', '..', '..', 'src', 'index.ts');
// D3 Task 8: the composition root (class MafwScheduler) lives in kernel.ts.
const KERNEL = path.join(__dirname, '..', '..', '..', 'src', 'kernel.ts');
const TRANSPORT = path.join(__dirname, '..', '..', '..', 'src', 'http', 'transport.ts');
const DASHBOARD_LEGACY = path.join(__dirname, '..', '..', '..', 'src', 'subsystems', 'dashboard-legacy.ts');

interface TransportInventory {
  /** `url === '/…'` exact-path branches (raw url: byte-identical semantics). */
  exact: string[];
  /** `pathname.startsWith('/…')` prefix branches (normalized once, D3-R2). */
  prefix: string[];
  /** Prefix + single-segment slot branches (`/a2a/artifacts/<id>`). */
  slots: number;
  total: number;
}

function transportInventory(): TransportInventory {
  const src = fs.readFileSync(TRANSPORT, 'utf-8');
  const exact = [...src.matchAll(/url === ['"](\/[^'"]*)['"]/g)].map((m) => m[1]);
  const prefix = [...src.matchAll(/pathname\.startsWith\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const slots = (src.match(/matchArtifactId\(url\)/g) || []).length;
  return { exact, prefix, slots, total: exact.length + prefix.length + slots };
}

interface DashboardInventory {
  /** `req.url?.startsWith('/…')` arms (method-agnostic catch-all shapes). */
  startsWith: string[];
  /** `req.url === '/…'` arms (POST memory.add / memory.pin). */
  exact: string[];
  total: number;
}

function dashboardInventory(): DashboardInventory {
  const src = fs.readFileSync(DASHBOARD_LEGACY, 'utf-8');
  const startsWith = [...src.matchAll(/req\.url\?\.startsWith\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const exact = [...src.matchAll(/req\.url === ['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return { startsWith, exact, total: startsWith.length + exact.length };
}

describe('legacy route inventory (Phase D1 baseline → D3 zero residue)', () => {
  const inv = inventory();

  it('index.ts carries zero legacy dispatch mass', () => {
    // Migration trail: D1 baseline 135 → 24 at D1 Task 9 (10 match + 14 equals),
    // then D3 Task 3 moved the HTTP transport chain (a2a/well-known/artifact/
    // mcp ×2/SPA ×4/register/control + dead /api/goals/control/health ×2):
    //   24 - 19 = 5 = 3 match + 2 equals.
    // D3 Task 4 moved handleDashboardAPI (goals.list / dashboard.stats /
    // memory.add / memory.pin / /api/memory catch-all) to subsystems/:
    //   5 - 5 = 0.
    expect(inv.byKind.match).toBe(0);
    expect(inv.byKind.equals).toBe(0);
    expect(inv.total).toBe(0);
  });

  it('has no residual route groups at all', () => {
    // The analyzer's groups are the positive-mass signal: zero groups means no
    // `/api/…` (or transport) prefix survives in index.ts. A new inline branch
    // resurrects a group here before it can reach production.
    expect(inv.groups).toEqual([]);
  });

  it('transport/root branches have left index.ts (D3 Task 3)', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    // Static/MCP/health/a2a/register/control/artifact are transport-level dispatch:
    // D3 Task 3 moved them into http/transport.ts (pinned by the inventory below).
    for (const moved of ['/assets', '/static', '/mcp', '/', '/index.html', '/health', '/a2a', '/a', '/.well-known', '/register', '/control']) {
      expect({ prefix: moved, count: byPrefix.get(moved) }).toEqual({ prefix: moved, count: undefined });
    }
  });

  it('index.ts has no bare `req.url?.` and no `req.url ===` dispatch left (D3-R2)', () => {
    // Independent of the analyzer's regexes: the D3-owned entry file must not
    // select a route from the URL at all — that is transport + registry work.
    const src = fs.readFileSync(INDEX, 'utf-8');
    expect(src).not.toMatch(/\breq\.url\?\.(?:match|startsWith)\s*\(/);
    expect(src).not.toMatch(/\breq\.url === ['"]/);
  });
});

// D3 Task 3: the transport residue is now pinned WHERE IT LIVES (the analyzer
// above only reads index.ts, which now pins 0).
describe('transport inventory (D3 Task 3: http/transport.ts)', () => {
  const tf = transportInventory();

  it('pins every transport dispatcher by kind', () => {
    // exact: /a2a, /.well-known/agent-card.json, /mcp (GET), / + /index.html
    // (SPA serve + SPA fallback inner check), /register, /control,
    // /api/goals/control (dead alias, R6), /health (rich + dead plain arm).
    expect(tf.exact.sort()).toEqual([
      '/',
      '/',
      '/.well-known/agent-card.json',
      '/a2a',
      '/api/goals/control',
      '/control',
      '/health',
      '/health',
      '/index.html',
      '/index.html',
      '/mcp',
      '/register',
    ]);
    // prefix: /mcp (POST legacy-SSE vs StreamableHTTP), /assets/ + /static/
    // (SPA assets), /api/goals + /api/stats + /api/memory (dashboard joint).
    expect(tf.prefix.sort()).toEqual([
      '/api/goals',
      '/api/memory',
      '/api/stats',
      '/assets/',
      '/mcp',
      '/static/',
    ]);
    // one prefix+split slot: /a2a/artifacts/<id> (D3-R2 rewrite of the old regex).
    expect(tf.slots).toBe(1);
    expect(tf.total).toBe(19);
  });

  it('keeps zero req.url?. dispatch branches (D3-R2)', () => {
    const src = fs.readFileSync(TRANSPORT, 'utf-8');
    expect(src).not.toMatch(/req\.url\?\.match\s*\(/);
    expect(src).not.toMatch(/req\.url\?\.startsWith\s*\(/);
  });

  it('preserves the dispatch order: OPTIONS → auth → registry → … → dashboard → control', () => {
    // The ordering is the contract (spec §4, Review Focus 1/2). A future move
    // that reorders these markers must fail here, not in production:
    //   - OPTIONS(204) before auth (CORS preflight must not need a token);
    //   - auth(401) before registry dispatch (P0-1);
    //   - registry before plugin-web / file-history / transport branches;
    //   - the dashboard joint catch-all before /control (ruling R6: otherwise the
    //     dead /api/goals/control alias would be resurrected).
    const src = fs.readFileSync(TRANSPORT, 'utf-8');
    const markers = [
      "res.setHeader('Content-Type', 'application/json')",
      'if (req.method === "OPTIONS") {',
      // E5a: the transport resolves principals (human/device/service/local) —
      // `resolvePrincipal` replaced the plain `authorizeRequest` gate here.
      'resolvePrincipal(',
      'deps.dispatchAuthorized(req, res, apiToken)',
      'deps.pluginWebWildcard(req, res)',
      'deps.fileHistory(req, res, isLoopback)',
      'url === "/a2a"',
      'pathname.startsWith("/api/goals")',
      "url === '/control'",
      "url === '/health'",
      'deps.proxyTarget()',
      "'[Scheduler] Unhandled request error:'",
    ];
    const positions = markers.map((m) => {
      const at = src.indexOf(m);
      expect({ marker: m, found: at }).not.toEqual({ marker: m, found: -1 });
      return at;
    });
    for (let i = 1; i < positions.length; i++) {
      expect({ step: markers[i], after: markers[i - 1], ok: positions[i] > positions[i - 1] })
        .toEqual({ step: markers[i], after: markers[i - 1], ok: true });
    }
  });
});

// D3 Task 4: the dashboard legacy dispatcher is now pinned WHERE IT LIVES. It
// still runs (R5), but out of the kernel and behind the transport's
// `dashboardDispatch` dep, so its shapes must stay byte-identical.
describe('dashboard legacy inventory (D3 Task 4: subsystems/dashboard-legacy.ts)', () => {
  const dl = dashboardInventory();

  it('pins the retained dashboard dispatchers by kind', () => {
    // startsWith: /api/goals (goals.list), /api/stats (dashboard.stats),
    // /api/memory (the "not yet implemented" catch-all).
    expect(dl.startsWith.sort()).toEqual(['/api/goals', '/api/memory', '/api/stats']);
    // exact POST pairs: memory.add, memory.pin.
    expect(dl.exact.sort()).toEqual(['/api/memory/add', '/api/memory/pin']);
    expect(dl.total).toBe(5);
  });

  it('is wired through transport as `dashboardDispatch`, after the joint branch', () => {
    // The transport still owns the joint branch position (before /control, R6);
    // the kernel hands it this module and nothing in the kernel body remains.
    // D3 Task 8: that wiring lives in kernel.ts now.
    const indexSrc = fs.readFileSync(KERNEL, 'utf-8');
    expect(indexSrc).toContain('handleDashboardAPI(req, this.dashboardLegacyDeps())');
    expect(indexSrc).not.toMatch(/handleDashboardAPI\s*\(req:\s*http\.IncomingMessage\)/);

    const moduleSrc = fs.readFileSync(DASHBOARD_LEGACY, 'utf-8');
    expect(moduleSrc).toContain('export async function handleDashboardAPI(');
    expect(moduleSrc).toContain('deps: DashboardLegacyDeps');
    // Lazy requires were re-anchored one level up (Global Constraint).
    expect(moduleSrc).not.toMatch(/require\('\.\//);
  });
});

// Task D fixed three catalog paths that used `{id}` / `{itemId}` templates — the
// registry treats `{…}` as a literal segment, so those ops were silently
// undispatchable shadows (migrated endpoints 404'd). This guard makes the whole
// `{`/`}` class unrepresentable: catalog paths must use `:param` templates.
describe('route catalog path class guard (D1 Task D regression)', () => {
  it('no catalog path contains a brace template', () => {
    const braced = buildRouteCatalog()
      .filter((route) => route.path.includes('{') || route.path.includes('}'))
      .map((route) => `${route.method} ${route.path} (${route.operationId})`);
    expect(braced).toEqual([]);
  });
});
