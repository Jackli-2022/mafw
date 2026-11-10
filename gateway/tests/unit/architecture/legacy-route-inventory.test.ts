// Phase D1 baseline: index.ts's legacy dispatch chain, grouped by path prefix.
// Numbers DECREASE as migration tasks delete branches; the end state pins only
// the static/MCP/root transport branches (they migrate to http-router.ts in D3,
// not to RouteRegistry). Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
import { execFileSync } from 'child_process';
import * as path from 'path';

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
    expect(inv.byKind.match).toBe(23);
    expect(inv.byKind.equals).toBe(14);
    expect(inv.total).toBe(37);
  });

  it('groups match the D1 plan inventory', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    for (const gone of ['/api/cognition', '/api/python', '/api/tts', '/api/mobile', '/api/terminal', '/api/agent', '/api/media', '/api/projects', '/api/mafw-commands', '/api/merge-memory', '/api/triage', '/api/approvals', '/api/recall', '/api/automations', '/api/chat', '/api/obs', '/api/session', '/api/llm']) {
      expect(byPrefix.get(gone)).toBeUndefined(); // all migrated (Tasks 2-3e + A1-A5 + B1-B4 + C1-C3 + D1 + H1)
    }
    // questions/permissions/usage 的 7 条 match 分支落在 '/api' 聚合组（analyzer 对
    // 2 段式 api 路径的分组口径），因此只校验聚合数下降：66 → 59 → 57 → 56 → 47 → 42 → 36 → 29 → 23 → 13。
    // /api/memory 只剩 dashboard 侧残量（4：add / pin / 兜底 startsWith / catch-all）。
    // /api/goals 只剩 dashboard 兜底与 /control 等价臂（3）。
    // The biggest single group is the /api catch-all mass.
    expect(byPrefix.get('/api')).toBe(13);
  });

  it('transport/root branches are pinned — they are D3, not D1', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    // Static/MCP/health/a2a/register/control: transport-level dispatch that
    // migrates to http-router.ts in D3 — NOT RouteRegistry material in D1.
    expect(byPrefix.get('/assets')).toBe(1);
    expect(byPrefix.get('/static')).toBe(1);
    expect(byPrefix.get('/mcp')).toBe(2);
    expect(byPrefix.get('/')).toBe(2);
    expect(byPrefix.get('/index.html')).toBe(2);
    expect(byPrefix.get('/health')).toBe(2);
    expect(byPrefix.get('/a2a')).toBe(1);
    expect(byPrefix.get('/.well-known')).toBe(1);
    expect(byPrefix.get('/register')).toBe(1);
    expect(byPrefix.get('/control')).toBe(1);
  });

  it('the chain lives in the route region (lines ordered sanely)', () => {
    expect(inv.groups.length).toBeGreaterThan(5);
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
