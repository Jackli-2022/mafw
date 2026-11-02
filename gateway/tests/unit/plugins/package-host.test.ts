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
    (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
    options,
  );
}

describe('PluginHost staging, fingerprints and revisions', () => {
  let dir: string;
  let host: PluginHost | undefined;
  let bags: BagSpy[] = [];
  let createBag: () => RegistrationBag;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-stage-'));
    ({ bags, createBag } = trackBags());
    delete (globalThis as any).__mafwActivations;
    delete (globalThis as any).__mafwFail;
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
});
