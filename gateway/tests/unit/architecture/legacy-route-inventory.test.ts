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
    expect(inv.byKind.match).toBe(86);
    expect(inv.byKind.equals).toBe(25);
    expect(inv.total).toBe(111);
  });

  it('groups match the D1 plan inventory', () => {
    const byPrefix = new Map(inv.groups.map((g) => [g.prefix, g.count]));
    expect(byPrefix.get('/api/recall')).toBe(4);
    for (const gone of ['/api/cognition', '/api/python', '/api/tts', '/api/mobile', '/api/terminal', '/api/agent', '/api/media', '/api/projects', '/api/mafw-commands', '/api/merge-memory']) {
      expect(byPrefix.get(gone)).toBeUndefined(); // all migrated (Tasks 2-3e + A1/A2/A3)
    }
    // The biggest single group is the /api catch-all mass.
    expect(byPrefix.get('/api')).toBe(72);
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
    // Shrinks as whole prefixes migrate (A1: /api/projects → 14; A2: /api/mafw-commands → 13;
    // A3: /api/merge-memory → 12).
    expect(apiGroups.length).toBeGreaterThanOrEqual(12);
    const transportPrefixes = ['/assets', '/static', '/mcp', '/', '/index.html', '/health', '/a2a', '/.well-known', '/register', '/control'];
    for (const g of apiGroups) {
      expect(transportPrefixes).not.toContain(g.prefix);
    }
  });
});
