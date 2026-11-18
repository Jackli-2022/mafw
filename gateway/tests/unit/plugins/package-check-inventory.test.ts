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
import { runPluginStandardCommand } from '../../../src/cli/plugin-standard-command';
import { pluginTemplates } from '../../../src/cli/plugin-templates';

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

/**
 * Failure classification: `code` is the stable, machine-readable half of a
 * failed check (agents and CI switch on it instead of matching prose), and
 * `evaluated` says whether `activate()` ever completed. `code` exists only on
 * failures; a successful check always reports `evaluated: true`.
 */
describe('PluginHost.checkPackage failure classification', () => {
  it('classifies a directory without plugin.json as manifest_invalid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = path.join(dir, 'no-manifest');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = { name: "no-manifest" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('manifest_invalid');
    expect(result.evaluated).toBe(false);
  });

  it('classifies a manifest the normalizer rejects as manifest_invalid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'badapi', apiVersion: 3, kind: 'trusted', permissions: ['actions'],
    }, 'module.exports = { name: "badapi" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('manifest_invalid');
    expect(result.evaluated).toBe(false);
    expect(result.error).toContain('unsupported apiVersion: 3');
  });

  it('classifies a missing main file as entry_missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'gone', apiVersion: 2, kind: 'trusted', permissions: ['actions'], main: 'missing.js',
    }, 'module.exports = { name: "gone" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('entry_missing');
    expect(result.evaluated).toBe(false);
    expect(result.error).toContain('main file not found');
  });

  it('classifies an exported name that differs from the manifest as identity_mismatch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'declared', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
    }, `
module.exports = { name: 'other', async activate() {
  return { actions: { ping: { handler: () => null } } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('identity_mismatch');
    expect(result.evaluated).toBe(false);
    expect(result.error).toContain('name mismatch:');
  });

  it('classifies an out-of-bound registration as contribution_bound', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'bound', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'] } },
    }, `
module.exports = { name: 'bound', async activate() {
  return { actions: {
    ping: { handler: () => null },
    pong: { handler: () => null },
  } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.evaluated).toBe(false);
    expect(result.declared?.actions).toEqual(['ping']);
    // The rejected registration stays visible: the diff is the author's fix.
    expect([...(result.registered?.actions ?? [])].sort()).toEqual(['ping', 'pong']);
  });

  it('classifies a throwing activate as activation_failed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'boom', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'] } },
    }, `
module.exports = { name: 'boom', async activate() { throw new Error('kaput'); } };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('activation_failed');
    expect(result.evaluated).toBe(false);
    expect(result.error).toBe('kaput');
  });

  it('classifies an unavailable worker as worker_unavailable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'walled', apiVersion: 2, kind: 'untrusted', permissions: ['actions'],
    }, 'module.exports = { name: "walled" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('worker_unavailable');
    expect(result.evaluated).toBe(false);
  });

  it('reports evaluated on a clean check and never attaches a code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'fine', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { actions: ['ping'] } },
    }, `
module.exports = { name: 'fine', async activate() {
  return { actions: { ping: { handler: () => null } } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.evaluated).toBe(true);
    expect(result.code).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'code')).toBe(false);
  });

  it('keeps evaluated:true when activation legitimately registers nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'quiet', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { actions: [] } },   // zero bound, nothing registered
    }, `
module.exports = { name: 'quiet', usage: { name: 'quiet', async fetch() { return {}; } } };
`);
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.evaluated).toBe(true);
    expect(result.registered?.actions).toEqual([]);
  });
});

/**
 * The init→check round trip: what `mafw plugin init` writes must be accepted by
 * the same host that judges an install (no fixing up by hand in between).
 */
describe('mafw plugin init scaffold', () => {
  it('passes the real host check and reports the declared planes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-init-host-'));
    const code = await runPluginStandardCommand(['init', 'scaffold', '--dir', dir], {
      check: async () => { throw new Error('init must not need the check host'); },
      print: () => {},
    });
    expect(code).toBe(0);
    const root = path.join(dir, 'scaffold');
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.name).toBe('scaffold');
    expect(result.apiVersion).toBe(2);
    expect(result.kind).toBe('trusted');
    expect(result.permissions).toEqual(['actions', 'events']);
    expect(result.contributions).toEqual(['actions', 'events']);
    expect(result.declared).toMatchObject({
      actions: ['ping'], events: ['plugin:scaffold:ping'], http: false,
    });
    expect(result.registered).toMatchObject({
      actions: ['ping'], events: ['plugin:scaffold:ping'], tools: [], observers: [], http: 0,
    });
    // `check --strict` turns warnings into failures: the scaffold must be clean.
    expect(result.warnings ?? []).toEqual([]);
  });

  it('fails the bound as soon as the scaffold registers an undeclared action', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-init-bound-'));
    const files = pluginTemplates('scaffold');
    const root = path.join(dir, 'scaffold');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), files['plugin.json']);
    const body = files['index.js'].replace(
      'actions: {',
      'actions: {\n        pong: { handler: () => ({ pong: true }) },',
    );
    expect(body).not.toBe(files['index.js']);
    fs.writeFileSync(path.join(root, 'index.js'), body);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('action "pong" is not declared');
    expect(result.declared?.actions).toEqual(['ping']);
    // Registration order follows the source; only the set is meaningful here.
    expect([...(result.registered?.actions ?? [])].sort()).toEqual(['ping', 'pong']);
  });
});
