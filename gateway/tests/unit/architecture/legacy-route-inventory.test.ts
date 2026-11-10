// Phase D1 baseline: index.ts's legacy dispatch chain, grouped by path prefix.
// Numbers DECREASE as migration tasks delete branches. D1 END STATE (Task 9) was
// pinned at 24 (10 match + 14 equals); Phase D3 Task 3 moved the whole HTTP
// transport chain into `src/http/transport.ts`, so what is LEFT in index.ts is
// now only ONE kind of residue:
//   1. RETAINED dashboard dispatch (ruling R5) — the joint
//      `/api/goals | /api/stats | /api/memory` catch-all was handed to
//      transport.ts as a `dashboardDispatch` dep, but its *implementation*
//      (`handleDashboardAPI` + the joint inner branches) still lives in the
//      class until D3 Task 4. The four well-defined shadow entries
//      (goals.list / dashboard.stats / memory.add / memory.setSticky) are
//      registry-first.
//
// Moved out of index.ts by D3 Task 3 (NOT deleted): `/a2a`, `/.well-known`,
// `/a2a/artifacts/:id`, `/mcp` ×2, dashboard SPA (`/`, `/index.html`,
// `/assets/*`, `/static/*`), `/register`, `/control` + the dead
// `/api/goals/control` alias (ruling R6 — preserved verbatim, and still ordered
// AFTER the dashboard joint), the rich `/health` and the dead plain `/health`,
// plus the reverse-proxy fallback. Those branches are now pinned by the
// transport inventory below (`src/http/transport.ts`), same anchoring semantics.
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

const TRANSPORT = path.join(__dirname, '..', '..', '..', 'src', 'http', 'transport.ts');

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

describe('legacy route inventory (Phase D1 baseline)', () => {
  const inv = inventory();

  it('index.ts has the documented legacy dispatch mass', () => {
    // Tasks 2-3e migrated: cognition 3, python 3, tools 2, tts 4, mobile 2,
    // terminal 1, agent 1, media 3 match. Baseline 135 → 87+29=116.
    // Task A1: projects 2 equals → 87+27=114.
    // Task A2: mafw-commands 1 match + 1 equals → 86+26=112.
    // Task A3: merge-memory 1 equals → 86+25=111.
    // Task A4: triage 3 match + 1 equals → 83+24=107.
    // Task A5: approvals 3 match + 1 equals → 80+23=103.
    // Task B1: questions 3 match + permissions 2 match → 75+23=98.
    // Task B2: usage 2 match → 73+23=96.
    // Task B3: recall thin three 3 match → 70+23=93.
    // Task B4: recall/context 1 match → 69+23=92.
    // Task C1: automations draft/list 2 equals + :id/:id-history 2 match → 67+21=88.
    // Task C2: chat send/sendEnriched 2 equals → 67+19=86.
    // Task C3: obs/capture 1 equals → 67+18=85.
    // Task C4: media resolve-task 1 match → 66+18=84.
    // Task D1: sessions core 1 equals + 9 match (create/get/deleteLegacy/abort/
    // background/promptAsync/prompt/queue list+clear+cancel) → 57+17=74.
    // Task E1: sessions read models 5 match (messages/todo/trajectory/
    // token-summary/children) → 52+17=69.
    // Task E2: permission-mode 1 + permissions reply 1 + subagents 4 match
    // (message/cancel/result + the shared spawn/list const) → 46+17=63.
    // Task F1: memory 7 match + merged-search/energy-distribution 2 equals →
    // 39+15=54.
    // Task F2: goals inline 6 match (respond/retry/plan×2/validate/complete) →
    // 33+15=48.
    // Task H1: long-tail singles 10 match (voice/presence/eval/config×2/
    // orchestration/provider/agents/media-plugins×2) + llm/compress 1 equals →
    // 23+14=37.
    // Task H2: pods events 3 match (seenAll/seenOne/list shared consts) + mcp 2 match
    // (facade + config facade) + devices/mobile 8 match (devices POST/GET/DELETE +
    // mobile list/delete/register + pairing-code/verify) → 10+14=24. The
    // manager/session + events SSE branches are `req.url && …startsWith` blind
    // spots (no `?.`) — never counted, migrated anyway.
    // Task 9: D1 END STATE pin — 24 = 10 match + 14 equals.
    // D3 Task 3: the whole transport chain (a2a/well-known/artifact/mcp ×2/SPA ×4/
    // register/control + dead /api/goals/control/health ×2) left index.ts for
    // http/transport.ts. What remains is the joint dashboard catch-all plus the
    // three handleDashboardAPI inner branches (Task 4 moves them):
    //   24 - 19 = 5 = 3 match + 2 equals.
    expect(inv.byKind.match).toBe(3);
    expect(inv.byKind.equals).toBe(2);
    expect(inv.total).toBe(5);
  });

  it('groups match the D1 plan inventory', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    for (const gone of ['/api/cognition', '/api/python', '/api/tts', '/api/mobile', '/api/terminal', '/api/agent', '/api/media', '/api/projects', '/api/mafw-commands', '/api/merge-memory', '/api/triage', '/api/approvals', '/api/recall', '/api/automations', '/api/chat', '/api/obs', '/api/session', '/api/llm', '/api/events', '/api/devices', '/api/pods', '/api/voice', '/api/presence', '/api/eval', '/api/config', '/api/orchestration', '/api/provider', '/api/agents', '/api/questions', '/api/permissions', '/api/usage']) {
      expect(byPrefix.get(gone)).toBeUndefined(); // all migrated (Tasks 2-3e + A1-A5 + B1-B4 + C1-C3 + D1 + E1-E2 + F1-F2 + H1-H2)
    }
    // questions/permissions/usage 的 7 条 match 分支曾落在 '/api' 聚合组（analyzer 对
    // 2 段式 api 路径的分组口径）：66 → 59 → 57 → 56 → 47 → 42 → 36 → 29 → 23 → 13。
    // Task H2 迁走最后 13 条（pods events 3 / mcp 2 / devices+mobile 8）→ 该组消失。
    expect(byPrefix.get('/api')).toBeUndefined();
  });

  it('residual /api groups are the R5 dashboard dispatch only', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    // R5: the joint catch-all branch is handed to transport.ts, but the
    // handleDashboardAPI body (and its three inner startsWith branches) is still
    // in index.ts until D3 Task 4. These are the ONLY /api-prefixed legacy hits.
    // /api/memory 3 = memory.add + memory.pin + the joint catch-all's memory arm.
    // /api/goals 1 = handleDashboardAPI's goals.list.
    // /api/stats 1 = handleDashboardAPI's dashboard.stats.
    expect(byPrefix.get('/api/memory')).toBe(3);
    expect(byPrefix.get('/api/goals')).toBe(1);
    expect(byPrefix.get('/api/stats')).toBe(1);
  });

  it('transport/root branches have left index.ts (D3 Task 3)', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    // Static/MCP/health/a2a/register/control/artifact are transport-level dispatch:
    // D3 Task 3 moved them into http/transport.ts (pinned by the inventory below).
    for (const moved of ['/assets', '/static', '/mcp', '/', '/index.html', '/health', '/a2a', '/a', '/.well-known', '/register', '/control']) {
      expect({ prefix: moved, count: byPrefix.get(moved) }).toEqual({ prefix: moved, count: undefined });
    }
  });

  it('the chain lives in the route region (lines ordered sanely)', () => {
    expect(inv.groups.length).toBeGreaterThan(0);
    for (const g of inv.groups) {
      expect(g.lines[0]).toBeLessThanOrEqual(g.lines[1]);
      expect(g.lines[0]).toBeGreaterThan(5000); // inside the request handler region
      expect(g.lines[1]).toBeLessThan(11000);
    }
  });

  it('D1 migration targets are enumerable (api-prefixed groups, not transport)', () => {
    const apiGroups = inv.groups.filter((g) => g.prefix.startsWith('/api'));
    // Per-prefix counts shrink as whole domains migrate; no fixed group-count
    // ratchet here (it would have to change every batch).
    const transportPrefixes = ['/assets', '/static', '/mcp', '/', '/index.html', '/health', '/a2a', '/.well-known', '/register', '/control'];
    for (const g of apiGroups) {
      expect(transportPrefixes).not.toContain(g.prefix);
    }
  });
});

// D3 Task 3: the transport residue is now pinned WHERE IT LIVES. The analyzer
// above still reads index.ts only (that is what its 5-pin guards), so without
// this the moved branches would silently stop being tracked.
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
      'authorizeRequest({',
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
