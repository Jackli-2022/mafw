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
 * `evaluated` says whether the package ever produced a contribution set (i.e.
 * whether `registered` is evidence). `code` exists only on failures.
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

  it('classifies a non-string main with the normalizer message, not entry_missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    // `path.join(pkgDir, 123)` throws a Node TypeError, so normalizing before
    // the entry stage is what keeps this a manifest problem.
    const root = writePackage(dir, {
      name: 'mainnum', apiVersion: 2, kind: 'trusted', permissions: ['actions'], main: 123,
    }, 'module.exports = { name: "mainnum" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('manifest_invalid');
    expect(result.evaluated).toBe(false);
    expect(result.error).toBe('main must be a relative path inside the package');
    expect(result.error).not.toContain('main file not found');
  });

  it('prefers the manifest rejection over an entry rejection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'bothbad', apiVersion: 3, kind: 'trusted', permissions: ['actions'], main: 'missing.js',
    }, 'module.exports = { name: "bothbad" };\n');
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('manifest_invalid');
    expect(result.error).toContain('unsupported apiVersion: 3');
    expect(result.error).not.toContain('main file not found');
  });

  it('classifies a path that does not exist as candidate_missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const result = await check(path.join(dir, 'typo'));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('candidate_missing');
    expect(result.evaluated).toBe(false);
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
    // activate() returned and the rejected set is visible: the check saw the
    // package's contributions even though it refused them.
    expect(result.evaluated).toBe(true);
    expect(result.declared?.actions).toEqual(['ping']);
    // The rejected registration stays visible: the diff is the author's fix.
    expect([...(result.registered?.actions ?? [])].sort()).toEqual(['ping', 'pong']);
  });

  it('classifies undeclared http routes as contribution_bound', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, {
      name: 'silenthttp', apiVersion: 2, kind: 'trusted', permissions: ['actions'],
      contributes: { gateway: { http: false } },
    }, `
module.exports = { name: 'silenthttp', async activate(ctx) {
  ctx.http.route('GET', '/x', () => ({ body: 'ok' }));
  return {};
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.evaluated).toBe(true);
    expect(result.error).toContain('http routes are not declared');
    // The route is part of the rejected contribution set, so it must be quoted.
    expect(result.registered?.http).toBe(1);
  });

  it('classifies a manifest-less package widening http as contribution_bound', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    // Single-file candidate: no plugin.json, so no declared plane at all.
    const root = path.join(dir, 'solo.js');
    fs.writeFileSync(root, `
module.exports = { name: 'solo', async activate(ctx) {
  ctx.http.route('GET', '/x', () => ({ body: 'ok' }));
  return {};
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.evaluated).toBe(true);
    expect(result.error).toContain('packages without plugin.json cannot contribute');
    expect(result.registered?.http).toBe(1);
  });

  it('classifies an unresolvable web surface entry as contribution_bound', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-code-'));
    const root = writePackage(dir, { name: 'badweb' }, `
module.exports = { name: 'badweb', async activate() {
  return { ui: { webSurfaces: [{ id: 'main', title: 'Main', entry: 'missing.html' }] } };
} };
`);
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.evaluated).toBe(true);
    expect(result.error).toContain('invalid web surfaces:');
    expect(result.error).toContain('missing.html');
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

/**
 * The legacy singleton planes (`runtime` / `media` / `tts` / `usage`) are named
 * declarations, not array memberships: a declared plane pins the instance name
 * (defaulting to the package name) and, for `media`, the modalities it may
 * serve. Undeclared means unconstrained; declared-but-not-registered is legal
 * because packages register conditionally.
 */
describe('PluginHost.checkPackage legacy plane declarations', () => {
  function body(name: string, contributions: string): string {
    return `module.exports = { name: '${name}', async activate() { return { ${contributions} }; } };`;
  }

  const runtime = (name: string): string => `
    runtime: { name: '${name}', async createRuntime() { return { name: '${name}', capabilities: {} }; } },`;

  /** Same instance as `runtime(name)` with the optional name omitted. */
  const anonymousRuntime = (name: string): string => `
    runtime: { async createRuntime() { return { name: '${name}', capabilities: {} }; } },`;

  const media = (name: string, modalities: string): string => `
    media: {
      name: '${name}',
      modalities: [${modalities}],
      createPrompt: async () => async () => ({}),
    },`;

  const tts = (name: string): string => `
    tts: {
      name: '${name}',
      capabilities: { sampleRate: 24000 },
      voices() { return []; },
      async synthesize() { return Buffer.from(''); },
    },`;

  const usage = (name: string): string => `
    usage: { name: '${name}', async fetch() { return null; } },`;

  it('fails a runtime whose name is not the declared one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'rtpkg', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { runtime: { name: 'r1' } } },
    }, body('rtpkg', runtime('r2')));
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    // The rejected instance is still evidence: both sides of the diff survive.
    expect(result.evaluated).toBe(true);
    expect(result.error).toBe(
      'invalid contributions: runtime "r2" is not declared in plugin.json contributes.gateway.runtime',
    );
    expect(result.declared?.runtime).toBe('r1');
    expect(result.registered?.runtime).toBe('r2');
  });

  it('reads an empty runtime declaration as the package name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'defrt', apiVersion: 2, kind: 'trusted', permissions: [],
      // `{}` is a real declaration, not "any name": the default IS the bound.
      contributes: { gateway: { runtime: {} } },
    }, body('defrt', anonymousRuntime('defrt')));
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.declared?.runtime).toBe('defrt');
    expect(result.registered?.runtime).toBe('defrt');
  });

  it('fails a media modality the declaration does not allow', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'medpkg', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { media: { name: 'm1', modalities: ['image'] } } },
    }, body('medpkg', media('m1', "'image', 'video'")));
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.error).toBe(
      'invalid contributions: media modality "video" is not declared '
      + 'in plugin.json contributes.gateway.media.modalities',
    );
    expect(result.declared?.media).toEqual({ name: 'm1', modalities: ['image'] });
    expect(result.registered?.media).toEqual({ name: 'm1', modalities: ['image', 'video'] });
  });

  it('accepts media modalities that stay inside the declaration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'medok', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { media: { name: 'm1', modalities: ['image', 'video'] } } },
    }, body('medok', media('m1', "'image', 'video'")));
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.declared?.media).toEqual({ name: 'm1', modalities: ['image', 'video'] });
    expect(result.registered?.media).toEqual({ name: 'm1', modalities: ['image', 'video'] });
  });

  it('fails a media instance whose name is not the declared one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'medname', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { media: { name: 'm1', modalities: ['image'] } } },
    }, body('medname', media('m2', "'image'")));
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      'invalid contributions: media "m2" is not declared in plugin.json contributes.gateway.media',
    );
  });

  it('fails a tts name that is not the declared one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'ttspkg', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { tts: { name: 't1' } } },
    }, body('ttspkg', tts('t2')));
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.error).toBe(
      'invalid contributions: tts "t2" is not declared in plugin.json contributes.gateway.tts',
    );
    expect(result.declared?.tts).toBe('t1');
    expect(result.registered?.tts).toBe('t2');
  });

  it('fails a usage name that is not the declared one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'usgpkg', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { usage: { name: 'u1' } } },
    }, body('usgpkg', usage('u2')));
    const result = await check(root);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('contribution_bound');
    expect(result.error).toBe(
      'invalid contributions: usage "u2" is not declared in plugin.json contributes.gateway.usage',
    );
    expect(result.declared?.usage).toBe('u1');
    expect(result.registered?.usage).toBe('u2');
  });

  it('accepts matching tts and usage names', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'bothok', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { tts: { name: 't1' }, usage: { name: 'u1' } } },
    }, body('bothok', `${tts('t1')}${usage('u1')}`));
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.declared?.tts).toBe('t1');
    expect(result.declared?.usage).toBe('u1');
    expect(result.registered?.tts).toBe('t1');
    expect(result.registered?.usage).toBe('u1');
  });

  it('imposes nothing on an undeclared legacy plane', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'freeall', apiVersion: 2, kind: 'trusted', permissions: [],
      // No contributes block at all: every legacy plane stays unconstrained.
    }, body('freeall', `${runtime('free-rt')}${media('free-media', "'image'")}${tts('free-tts')}${usage('free-usage')}`));
    const result = await check(root);
    expect(result.ok).toBe(true);
    expect(result.declared).toBeUndefined();
    expect(result.registered?.runtime).toBe('free-rt');
    expect(result.registered?.media).toEqual({ name: 'free-media', modalities: ['image'] });
    expect(result.registered?.tts).toBe('free-tts');
    expect(result.registered?.usage).toBe('free-usage');
  });

  it('keeps a declared plane that never registered legal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-legacy-'));
    const root = writePackage(dir, {
      name: 'condrt', apiVersion: 2, kind: 'trusted', permissions: [],
      contributes: { gateway: { runtime: { name: 'r1' } } },
    }, body('condrt', usage('u1')));
    const result = await check(root);
    // Conditional registration: the declaration is an upper bound, not a plan.
    expect(result.ok).toBe(true);
    expect(result.declared?.runtime).toBe('r1');
    expect(result.registered?.runtime).toBeUndefined();
  });
});
