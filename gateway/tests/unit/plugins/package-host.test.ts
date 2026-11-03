import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost, type PluginHostOptions } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import { createRegistrationBag, type RegistrationBag } from '../../../src/plugins/registration-bag';

/**
 * Package bodies read their behaviour from globals so a "changed" candidate can
 * fail without depending on jest's module-registry behaviour (the suite must not
 * assume `require.cache` eviction re-evaluates a module).
 */
const DECLARATIVE = (name: string, title: string) => `
module.exports = { name: '${name}', async activate() {
  const g = globalThis;
  g.__mafwActivations = (g.__mafwActivations || 0) + 1;
  if (g.__mafwFail === '${name}') throw new Error('boom');
  return {
    ui: { panels: [{ id: 'main', title: '${title}', viewAction: 'load' }] },
    actions: { load: { handler: async () => ({ title: '${title}' }) } },
    usage: { name: '${name}', type: 'api', plan: '${title}', async fetch() { return null; } },
  };
} };
`;

const RUNTIME = (name: string) => `
module.exports = { name: '${name}', async activate() {
  const g = globalThis;
  g.__mafwActivations = (g.__mafwActivations || 0) + 1;
  if (g.__mafwFail === '${name}') throw new Error('boom');
  return { runtime: { name: '${name}', async createRuntime() { return { name: '${name}', capabilities: {} }; } } };
} };
`;

/**
 * Registers a custom cleanup through `ctx.effect`, the package-facing
 * registration hook for timers/listeners that live outside the declared
 * contributions.
 */
const EFFECTFUL = (name: string) => `
module.exports = { name: '${name}', async activate(ctx) {
  const g = globalThis;
  g.__mafwActivations = (g.__mafwActivations || 0) + 1;
  ctx.effect(() => { g.__mafwEffectCleanups = (g.__mafwEffectCleanups || 0) + 1; });
  return { usage: { name: '${name}', type: 'api', async fetch() { return null; } } };
} };
`;

interface BagSpy {
  dispose: jest.Mock;
}

function trackBags(): { bags: BagSpy[]; createBag: () => RegistrationBag } {
  const bags: BagSpy[] = [];
  const createBag = (): RegistrationBag => {
    const inner = createRegistrationBag();
    const dispose = jest.fn(() => inner.dispose());
    bags.push({ dispose });
    return {
      get size() { return inner.size; },
      get disposed() { return inner.disposed; },
      add: (name, fn) => inner.add(name, fn),
      effect: (fn) => inner.effect(fn),
      dispose,
    };
  };
  return { bags, createBag };
}

function mkHost(dir: string, options: PluginHostOptions = {}): PluginHost {
  return new PluginHost(
    dir,
    (name, bag) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000, bag }),
    options,
  );
}

describe('PluginHost staging, fingerprints and revisions', () => {
  let dir: string;
  let host: PluginHost | undefined;
  let bags: BagSpy[] = [];
  let createBag: () => RegistrationBag;
  let activeRuntime: string | null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-stage-'));
    ({ bags, createBag } = trackBags());
    activeRuntime = null;
    delete (globalThis as any).__mafwActivations;
    delete (globalThis as any).__mafwFail;
    delete (globalThis as any).__mafwEffectCleanups;
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('activates a declarative-only package without any legacy contribution', async () => {
    fs.writeFileSync(path.join(dir, 'viewer.js'), `
module.exports = { name: 'viewer', async activate() {
  return {
    ui: { panels: [{ id: 'view', title: 'View', viewAction: 'load' }] },
    actions: { load: { handler: async () => ({ ok: true }) } },
  };
} };
`);
    host = mkHost(dir, { createBag });
    const usage: any[] = [];
    host.bindUsage((entries) => { usage.length = 0; usage.push(...entries); });
    await host.init();

    const snapshot = host.getClientSnapshot();
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.plugins[0].ui.panels?.[0].id).toBe('view');
    expect(snapshot.plugins[0].actions.map((action) => action.name)).toEqual(['load']);
    expect(usage).toEqual([]);
    expect(host.getState()[0]).toMatchObject({ status: 'ok', contributions: ['actions', 'ui'] });
  });

  it('reuses an unchanged package without reactivating or disposing it', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });

    const usage: any[] = [];
    host.bindUsage((entries) => { usage.length = 0; usage.push(...entries); });
    await host.init();

    const firstSnapshot = host.getClientSnapshot();
    const firstEntry = usage[0];
    expect((globalThis as any).__mafwActivations).toBe(1);

    await host.reload();

    expect((globalThis as any).__mafwActivations).toBe(1);
    expect(host.getClientSnapshot()).toBe(firstSnapshot);
    expect(usage[0]).toBe(firstEntry);
    expect(bags[0].dispose).not.toHaveBeenCalled();
  });

  it('gives a changed package a new revision and disposes only the replaced activation', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    await host.init();

    const before = host.getClientSnapshot();
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    const after = host.getClientSnapshot();
    expect(after.revision).not.toBe(before.revision);
    expect(after.plugins).toHaveLength(1);
    expect(after.plugins[0].revision).toBe(after.revision);
    expect((globalThis as any).__mafwActivations).toBe(2);
    expect(bags[0].dispose).toHaveBeenCalledTimes(1);
    expect(bags[1].dispose).not.toHaveBeenCalled();
  });

  it('commits two changed packages in one snapshot revision', async () => {
    const alpha = path.join(dir, 'alpha.js');
    const beta = path.join(dir, 'beta.js');
    fs.writeFileSync(alpha, DECLARATIVE('alpha', 'Alpha'));
    fs.writeFileSync(beta, DECLARATIVE('beta', 'Beta'));
    host = mkHost(dir, { createBag });
    await host.init();

    const before = host.getClientSnapshot();
    fs.appendFileSync(alpha, '\n// changed\n');
    fs.appendFileSync(beta, '\n// changed\n');
    await host.reload();

    const after = host.getClientSnapshot();
    expect(after.revision).not.toBe(before.revision);
    expect(after.plugins.map((plugin) => plugin.name)).toEqual(['alpha', 'beta']);
    expect(after.plugins.map((plugin) => plugin.revision)).toEqual([after.revision, after.revision]);
  });

  it('keeps the revision of an unrelated package unchanged', async () => {
    const alpha = path.join(dir, 'alpha.js');
    const beta = path.join(dir, 'beta.js');
    fs.writeFileSync(alpha, DECLARATIVE('alpha', 'Alpha'));
    fs.writeFileSync(beta, DECLARATIVE('beta', 'Beta'));
    host = mkHost(dir, { createBag });
    await host.init();

    const before = new Map(host.getClientSnapshot().plugins.map((plugin) => [plugin.name, plugin.revision]));
    fs.appendFileSync(alpha, '\n// changed\n');
    await host.reload();

    const after = new Map(host.getClientSnapshot().plugins.map((plugin) => [plugin.name, plugin.revision]));
    expect(after.get('alpha')).not.toBe(before.get('alpha'));
    expect(after.get('beta')).toBe(before.get('beta'));
    expect(bags[1].dispose).not.toHaveBeenCalled();
  });

  it('keeps the old descriptor usable when a changed candidate fails', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    await host.init();
    const before = host.getClientSnapshot();

    (globalThis as any).__mafwFail = 'acme';
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    const after = host.getClientSnapshot();
    expect(after).toBe(before);
    expect(after.plugins[0].ui.panels?.[0].title).toBe('Main');
    expect(after.plugins[0].revision).toBe(before.plugins[0].revision);

    const state = host.getState().find((entry) => entry.name === 'acme');
    expect(state).toMatchObject({ status: 'error', error: 'boom', revision: before.plugins[0].revision });
    expect(bags[0].dispose).not.toHaveBeenCalled();
    expect(bags[1].dispose).toHaveBeenCalledTimes(1);
  });

  it('does not publish a descriptor for a package that fails to load', async () => {
    fs.writeFileSync(path.join(dir, 'bad.js'), `throw new Error('kaboom');`);
    host = mkHost(dir, { createBag });
    await host.init();

    expect(host.getClientSnapshot().plugins).toEqual([]);
    const state = host.getState().find((entry) => entry.name === 'bad');
    expect(state?.status).toBe('error');
    expect(state?.error).toMatch(/kaboom/);
    expect(bags[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('removes the descriptor when a package is deleted', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    await host.init();
    const before = host.getClientSnapshot();
    expect(before.plugins).toHaveLength(1);

    fs.rmSync(file);
    await host.reload();

    const after = host.getClientSnapshot();
    expect(after.plugins).toEqual([]);
    expect(after.revision).not.toBe(before.revision);
    expect(bags[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh bootId for every host instance', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    await host.init();
    const firstRevision = host.getClientSnapshot().revision;
    expect(firstRevision).toMatch(/^[^:]+:\d+$/);

    const other = mkHost(dir, { createBag });
    try {
      await other.init();
      const secondRevision = other.getClientSnapshot().revision;
      expect(secondRevision.split(':')[0]).not.toBe(firstRevision.split(':')[0]);
    } finally {
      other.stop();
    }
  });

  it('stages a changed active-runtime package as pending and leaves the loader untouched', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, { createBag, activeRuntime: () => 'rt' });
    const runtime: any[] = [];
    host.bindRuntime((entries) => { runtime.length = 0; runtime.push(...entries); });
    await host.init();

    const before = host.getClientSnapshot();
    const firstEntry = runtime[0];
    expect(runtime).toHaveLength(1);
    expect(host.getPending('rt')).toBeNull();

    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    const pending = host.getPending('rt');
    expect(pending?.revision).toMatch(/^[^:]+:\d+$/);
    expect(pending?.error).toBeUndefined();
    expect(host.getClientSnapshot()).toBe(before);
    expect(runtime[0]).toBe(firstEntry);
    expect(host.getState().find((entry) => entry.name === 'rt')).toMatchObject({
      status: 'ok',
      pendingRevision: pending?.revision,
    });

    // A second scan of the same staged files must not activate the candidate again.
    await host.reload();
    expect(host.getPending('rt')?.revision).toBe(pending?.revision);
    expect((globalThis as any).__mafwActivations).toBe(2);
  });

  it('applies a pending revision atomically', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, { createBag, activeRuntime: () => 'rt' });
    const runtime: any[] = [];
    host.bindRuntime((entries) => { runtime.length = 0; runtime.push(...entries); });
    await host.init();
    const firstEntry = runtime[0];
    const before = host.getClientSnapshot();

    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    const pending = host.getPending('rt');

    const result = await host.applyPending('rt');
    expect(result.applied).toBe(true);
    const after = host.getClientSnapshot();
    expect(result.revision).toBe(after.revision);
    expect(after.revision).not.toBe(before.revision);
    expect(after.plugins[0].revision).toBe(after.revision);
    expect(host.getPending('rt')).toBeNull();
    expect(runtime[0]).not.toBe(firstEntry);
    expect(bags[0].dispose).toHaveBeenCalledTimes(1);
    expect(bags[1].dispose).not.toHaveBeenCalled();
  });

  it('reports a missing pending revision instead of committing anything', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    await host.init();
    const before = host.getClientSnapshot();

    const result = await host.applyPending('acme');
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/no pending revision/i);
    expect(host.getClientSnapshot()).toBe(before);
  });

  it('drops a pending candidate when the package reverts to the active content', async () => {
    const file = path.join(dir, 'rt.js');
    const original = RUNTIME('rt');
    fs.writeFileSync(file, original);
    host = mkHost(dir, { createBag, activeRuntime: () => 'rt' });
    await host.init();
    const before = host.getClientSnapshot();

    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect(host.getPending('rt')).not.toBeNull();

    fs.writeFileSync(file, original);
    await host.reload();

    expect(host.getPending('rt')).toBeNull();
    expect(host.getClientSnapshot()).toBe(before);
    expect(bags[1].dispose).toHaveBeenCalledTimes(1);
    expect((globalThis as any).__mafwActivations).toBe(2);
  });

  it('records a failed active-runtime candidate as pending with the error', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, { createBag, activeRuntime: () => 'rt' });
    await host.init();
    const before = host.getClientSnapshot();

    (globalThis as any).__mafwFail = 'rt';
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    const pending = host.getPending('rt');
    expect(pending?.error).toMatch(/boom/);
    expect(host.getClientSnapshot()).toBe(before);
    expect(host.getState().find((entry) => entry.name === 'rt')).toMatchObject({ status: 'error', error: 'boom' });

    const applied = await host.applyPending('rt');
    expect(applied.applied).toBe(false);
    expect(applied.error).toMatch(/boom/);
    expect(host.getClientSnapshot()).toBe(before);
  });

  it('keeps a failed pending candidate visible in package state across scans', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, { createBag, activeRuntime: () => 'rt' });
    await host.init();
    const before = host.getClientSnapshot();

    (globalThis as any).__mafwFail = 'rt';
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect(host.getState().find((entry) => entry.name === 'rt')).toMatchObject({ status: 'error', error: 'boom' });

    // Same files scanned again: the candidate is reused, not re-activated, and
    // the Hub must keep showing the failure instead of falling back to "ok".
    await host.reload();
    expect(host.getState().find((entry) => entry.name === 'rt')).toMatchObject({
      status: 'error',
      error: 'boom',
      revision: before.plugins[0].revision,
    });
    expect(host.getPending('rt')?.error).toMatch(/boom/);
    expect((globalThis as any).__mafwActivations).toBe(2);

    // An unrelated commit in the same scan must not erase the pending error.
    fs.writeFileSync(path.join(dir, 'other.js'), DECLARATIVE('other', 'Other'));
    await host.reload();
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['other', 'rt']);
    expect(host.getState().find((entry) => entry.name === 'rt')).toMatchObject({
      status: 'error',
      error: 'boom',
      pendingRevision: expect.any(String),
    });
    expect(host.getState().find((entry) => entry.name === 'other')).toMatchObject({ status: 'ok' });
    expect(host.getClientSnapshot().plugins[1].revision).toBe(before.plugins[0].revision);
  });

  it('evicts only the changed package local module cache', async () => {
    const packageBody = (name: string) => `
const helper = require('./lib/helper');
module.exports = { name: '${name}', async activate() {
  return { usage: { name: '${name}', type: 'api', plan: String(helper.version), async fetch() { return null; } } };
} };
`;
    const roots: Record<string, string> = { alpha: path.join(dir, 'alpha'), beta: path.join(dir, 'beta') };
    for (const [name, root] of Object.entries(roots)) {
      fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0' }));
      fs.writeFileSync(path.join(root, 'lib', 'helper.js'), 'module.exports = { version: 1 };\n');
      fs.writeFileSync(path.join(root, 'index.js'), packageBody(name));
    }

    host = mkHost(dir, { createBag });
    await host.init();

    const alphaProbe = path.join(roots.alpha, 'lib', 'cached-probe.js');
    const betaProbe = path.join(roots.beta, 'lib', 'cached-probe.js');
    const stub = (id: string) => ({ id, filename: id, loaded: true, exports: {} }) as any;
    require.cache[alphaProbe] = stub(alphaProbe);
    require.cache[betaProbe] = stub(betaProbe);
    const betaEntry = require.cache[betaProbe];
    const hostModule = require.resolve('../../../src/plugins/package-host');
    expect(require.cache[hostModule]).toBeDefined();

    const before = new Map(host.getClientSnapshot().plugins.map((plugin) => [plugin.name, plugin.revision]));
    fs.appendFileSync(path.join(roots.alpha, 'lib', 'helper.js'), '\n// v2\n');
    await host.reload();

    // Changed package subtree: gone. Sibling package + gateway module: untouched.
    expect(require.cache[alphaProbe]).toBeUndefined();
    expect(require.cache[betaProbe]).toBe(betaEntry);
    expect(require.cache[hostModule]).toBeDefined();

    const after = new Map(host.getClientSnapshot().plugins.map((plugin) => [plugin.name, plugin.revision]));
    expect(after.get('alpha')).not.toBe(before.get('alpha'));
    expect(after.get('beta')).toBe(before.get('beta'));

    delete require.cache[alphaProbe];
    delete require.cache[betaProbe];
  });

  it('keeps the last active descriptor when a package directory becomes unreadable', async () => {
    const root = path.join(dir, 'big');
    fs.mkdirSync(root);
    // Folder name differs from the manifest name: the failure must map back to
    // the running package instead of unloading it under the folder key.
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'big-pkg', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'index.js'), DECLARATIVE('big-pkg', 'Big'));
    host = mkHost(dir, { createBag });
    await host.init();
    const before = host.getClientSnapshot();
    expect(before.plugins[0].version).toBe('1.0.0');

    fs.rmSync(path.join(root, 'index.js'));
    await host.reload();

    expect(host.getClientSnapshot()).toBe(before);
    expect(host.getState().find((entry) => entry.name === 'big-pkg')).toMatchObject({
      status: 'error',
      revision: before.plugins[0].revision,
    });
    expect(host.getState().find((entry) => entry.name === 'big')).toBeUndefined();
    expect(bags[0].dispose).not.toHaveBeenCalled();
  });

  it('notifies snapshot and state subscribers only on real changes', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, { createBag });
    const snapshots: any[] = [];
    const onStateChanged = jest.fn();
    host.onSnapshot((snapshot) => snapshots.push(snapshot));
    host.onStateChanged(onStateChanged);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({ revision: host.getClientSnapshot().revision, plugins: [] });

    await host.init();
    expect(snapshots).toHaveLength(2);
    expect(Object.isFrozen(snapshots[1])).toBe(true);
    const changesAfterInit = onStateChanged.mock.calls.length;
    expect(changesAfterInit).toBeGreaterThan(0);

    await host.reload();
    expect(onStateChanged).toHaveBeenCalledTimes(changesAfterInit);
    expect(snapshots).toHaveLength(2);

    (globalThis as any).__mafwFail = 'acme';
    fs.appendFileSync(path.join(dir, 'acme.js'), '\n// v2\n');
    await host.reload();
    expect(onStateChanged.mock.calls.length).toBeGreaterThan(changesAfterInit);
    expect(snapshots).toHaveLength(2);
  });

  it('disposes ctx.effect cleanups on a changed reload, delete and candidate check', async () => {
    const file = path.join(dir, 'fx.js');
    fs.writeFileSync(file, EFFECTFUL('fx'));
    host = mkHost(dir, { createBag });
    await host.init();
    expect((globalThis as any).__mafwEffectCleanups).toBeUndefined();

    // Changed package: the replaced activation's cleanup runs with its bag.
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect((globalThis as any).__mafwEffectCleanups).toBe(1);

    // Delete: the removed package's cleanup runs too.
    fs.rmSync(file);
    await host.reload();
    expect((globalThis as any).__mafwEffectCleanups).toBe(2);

    // Offline check: the candidate is disposed right after validation.
    const candidate = path.join(dir, 'candidate');
    fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(candidate, 'plugin.json'), JSON.stringify({ name: 'checked' }));
    fs.writeFileSync(path.join(candidate, 'index.js'), EFFECTFUL('checked'));
    const checked = await host.checkPackage(candidate);
    expect(checked).toMatchObject({ ok: true, name: 'checked' });
    expect((globalThis as any).__mafwEffectCleanups).toBe(3);
  });

  it('reports whether applying the pending revision must switch the active runtime', async () => {
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, { createBag, activeRuntime: () => activeRuntime });
    await host.init();
    expect(host.packageOwnsActiveRuntime('rt')).toBe(false);

    activeRuntime = 'rt';
    expect(host.packageOwnsActiveRuntime('rt')).toBe(true);
    expect(host.packageOwnsActiveRuntime('other')).toBe(false);

    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect(host.getPending('rt')).not.toBeNull();

    const applied = await host.applyPending('rt');
    expect(applied).toMatchObject({ applied: true, runtimeSwitchRequired: true });

    // A candidate staged for a runtime that is no longer active does not need
    // a switch at apply time: the live runtime is someone else's by then.
    fs.appendFileSync(file, '\n// v3\n');
    await host.reload();
    activeRuntime = 'other';
    const appliedLater = await host.applyPending('rt');
    expect(appliedLater).toMatchObject({ applied: true, runtimeSwitchRequired: false });
  });

  it('broadcasts a state-only plugins.changed for pending candidates without a commit', async () => {
    const frames: Array<{ type: string; properties?: Record<string, unknown> }> = [];
    const file = path.join(dir, 'rt.js');
    fs.writeFileSync(file, RUNTIME('rt'));
    host = mkHost(dir, {
      createBag,
      activeRuntime: () => activeRuntime,
      broadcast: (event) => frames.push(event as any),
    });
    await host.init();
    const committedRevision = host.getClientSnapshot().revision;
    frames.length = 0;

    activeRuntime = 'rt';
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    // Pending appears without a commit: the active snapshot (and revision) is
    // untouched, but clients must still be told the visible state changed.
    expect(host.getClientSnapshot().revision).toBe(committedRevision);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: 'plugins.changed',
      properties: { revision: committedRevision, stateChanged: true },
    });

    // A failed candidate without a commit is the same kind of state change.
    frames.length = 0;
    fs.writeFileSync(path.join(dir, 'bad.js'), `throw new Error('kaboom');`);
    await host.reload();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: 'plugins.changed',
      properties: { revision: committedRevision, stateChanged: true },
    });
  });

  it('broadcasts exactly one normal plugins.changed per commit', async () => {
    const frames: Array<{ type: string; properties?: Record<string, unknown> }> = [];
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, DECLARATIVE('acme', 'Main'));
    host = mkHost(dir, {
      createBag,
      activeRuntime: () => activeRuntime,
      broadcast: (event) => frames.push(event as any),
    });
    await host.init();
    frames.length = 0;

    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('plugins.changed');
    expect(frames[0].properties?.stateChanged).toBeUndefined();
    expect(frames[0].properties?.revision).toBe(host.getClientSnapshot().revision);

    // Applying a pending candidate is a commit: one normal event, no second
    // state-only duplicate.
    const rt = path.join(dir, 'rt.js');
    fs.writeFileSync(rt, RUNTIME('rt'));
    await host.reload();
    frames.length = 0;
    activeRuntime = 'rt';
    fs.appendFileSync(rt, '\n// v2\n');
    await host.reload();
    expect(frames).toHaveLength(1);
    expect(frames[0].properties?.stateChanged).toBe(true);
    frames.length = 0;

    await host.applyPending('rt');
    expect(frames).toHaveLength(1);
    expect(frames[0].properties?.stateChanged).toBeUndefined();
    expect(frames[0].properties?.revision).toBe(host.getClientSnapshot().revision);
  });

  it('resetWatchers closes and recreates directory watchers', async () => {
    const root = path.join(dir, 'watched');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'watched' }));
    fs.writeFileSync(path.join(root, 'index.js'), DECLARATIVE('watched', 'Watched'));
    host = mkHost(dir, { createBag });
    // Before init there is nothing to reset; must stay fail-open.
    expect(() => host!.resetWatchers()).not.toThrow();
    await host.init();

    const watchers = (host as any).dirWatchers as Map<string, { close: () => void }>;
    expect(watchers.size).toBe(1);
    const [[watchedDir, oldWatcher]] = [...watchers.entries()];
    expect(watchedDir).toBe(root);
    const closeSpy = jest.spyOn(oldWatcher, 'close');

    host.resetWatchers();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    const next = (host as any).dirWatchers as Map<string, { close: () => void }>;
    expect(next.size).toBe(1);
    expect(next.get(watchedDir)).toBeDefined();
    expect(next.get(watchedDir)).not.toBe(oldWatcher);
  });
});
