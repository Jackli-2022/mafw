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
    // Task 2: /api/cognition (3 match). Task 3a: /api/python (3 ===).
    // Task 3b: /api/tools (2 ===). Task 3c: /api/tts (4 ===). Task 3d:
    // mobile (2) + terminal (1) + agent (1). Baseline 135 → 88+31=119.
    expect(inv.byKind.match).toBe(88);
    expect(inv.byKind.equals).toBe(31);
    expect(inv.total).toBe(119);
  });

  it('groups match the D1 plan inventory', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    expect(byPrefix.get('/api/recall')).toBe(4);
    expect(byPrefix.get('/api/cognition')).toBeUndefined(); // migrated in Task 2
    expect(byPrefix.get('/api/python')).toBeUndefined();   // migrated in Task 3a
    expect(byPrefix.get('/api/tts')).toBeUndefined();       // migrated in Task 3c
    expect(byPrefix.get('/api/mobile')).toBeUndefined();   // migrated in Task 3d
    expect(byPrefix.get('/api/terminal')).toBeUndefined(); // migrated in Task 3d
    expect(byPrefix.get('/api/agent')).toBeUndefined();    // migrated in Task 3d
    // The biggest single group is the /api catch-all mass.
    expect(byPrefix.get('/api')).toBe(73);
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
    expect(apiGroups.length).toBeGreaterThanOrEqual(16);
    const transportPrefixes = ['/assets', '/static', '/mcp', '/', '/index.html', '/health', '/a2a', '/.well-known', '/register', '/control'];
    for (const g of apiGroups) {
      expect(transportPrefixes).not.toContain(g.prefix);
    }
  });
});
