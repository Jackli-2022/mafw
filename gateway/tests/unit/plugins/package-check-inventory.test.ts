/**
 * `PluginHost.checkPackage()` inventory: what the manifest *declares* (the
 * static upper bound in `contributes.gateway`) next to what `activate()`
 * actually tried to register.
 *
 * The pair is the agent-facing half of the standard: `mafw plugin check` prints
 * both lists so an author can see the bound without reading the validator.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';

function writePackage(dir: string, manifest: Record<string, unknown>, body: string): string {
  const root = path.join(dir, String(manifest.name));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'index.js'), body);
  return root;
}

async function check(root: string) {
  const host = new PluginHost(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-check-')),
    (pkg, bag) => createPluginPackageContext(pkg, { projectDir: '/p', gatewayPort: 3000, bag }),
  );
  try {
    return await host.checkPackage(root);
  } finally {
    host.stop();
  }
}

describe('PluginHost.checkPackage inventory', () => {
  it('reports declared and registered planes for a conforming package', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-inv-'));
    const root = writePackage(dir, {
      name: 'inv', apiVersion: 2, kind: 'trusted',
      permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'], http: true } },
    }, `
module.exports = { name: 'inv', async activate(ctx) {
  ctx.http.route('GET', '/x', () => ({ body: 'ok' }));
  return { actions: { ping: { handler: () => ({ ok: true }) } } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.declared).toMatchObject({ actions: ['ping'], http: true });
    expect(result.registered).toMatchObject({ actions: ['ping'], http: 1 });
    expect(result.kind).toBe('trusted');
    expect(result.permissions).toEqual(['actions']);
  });

  it('reports the diff when a registration is outside the declaration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-inv-'));
    const root = writePackage(dir, {
      name: 'inv2', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'] } },
    }, `
module.exports = { name: 'inv2', async activate() {
  return { actions: {
    ping: { handler: () => null },
    pong: { handler: () => null },
  } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('action "pong" is not declared');
    expect(result.declared?.actions).toEqual(['ping']);
    expect(result.registered?.actions).toEqual(['ping', 'pong']);
  });

  it('exposes parser warnings for --strict', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-inv-'));
    const root = writePackage(dir, {
      name: 'legacy', apiVersion: 2,            // v2 无 permissions → legacy-permissions warning
      contributes: { gateway: { actions: ['ping'] } },
    }, `
module.exports = { name: 'legacy', async activate() { return { actions: { ping: { handler: () => null } } }; } };
`);
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.warnings?.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps an explicit empty plane distinct from an absent one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-inv-'));
    const root = writePackage(dir, {
      name: 'emptybound', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { actions: [] } },   // zero bound, not "unbounded"
    }, `
module.exports = { name: 'emptybound', async activate() { return { actions: { ping: { handler: () => null } } }; } };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('action "ping" is not declared');
    expect(result.declared?.actions).toEqual([]);
    expect(result.declared?.events).toBeUndefined();
    expect(result.registered?.actions).toEqual(['ping']);
  });
});
