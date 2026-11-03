import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost, type PluginHostOptions } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import { createRegistrationBag, type RegistrationBag } from '../../../src/plugins/registration-bag';
import { PackageStateStore } from '../../../src/plugins/package-state-store';
import {
  PackageManager,
  PackageManagerError,
} from '../../../src/plugins/package-manager';

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

const DECLARATIVE_MODULE = (name: string, title: string) => `
module.exports = { name: '${name}', async activate() {
  const g = globalThis;
  g.__mafwActivations = (g.__mafwActivations || 0) + 1;
  if (g.__mafwFail === '${name}') throw new Error('boom');
  return {
    ui: { panels: [{ id: 'main', title: '${title}', viewAction: 'load' }] },
    actions: { load: { handler: async () => ({ title: '${title}' }) } },
  };
} };
`;

const RUNTIME_MODULE = (name: string) => `
module.exports = { name: '${name}', async activate() {
  const g = globalThis;
  g.__mafwActivations = (g.__mafwActivations || 0) + 1;
  return { runtime: { name: '${name}', async createRuntime() { return { name: '${name}', capabilities: {} }; } } };
} };
`;

interface PackageFiles {
  version?: string;
  module: string;
}

function writePackage(dir: string, name: string, files: PackageFiles): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    name,
    version: files.version ?? '1.0.0',
  }));
  fs.writeFileSync(path.join(root, 'index.js'), files.module);
  return root;
}

describe('PackageManager filesystem operations', () => {
  let base: string;
  let pluginDir: string;
  let sourceDir: string;
  let stateStore: PackageStateStore;
  let host: PluginHost | undefined;
  let manager: PackageManager;
  let bags: BagSpy[];
  let createBag: () => RegistrationBag;
  let activeRuntime: string | null;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pkg-mgr-'));
    pluginDir = path.join(base, 'plugins');
    sourceDir = path.join(base, 'sources');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    delete (globalThis as any).__mafwActivations;
    delete (globalThis as any).__mafwFail;

    ({ bags, createBag } = trackBags());
    activeRuntime = null;
    stateStore = new PackageStateStore(base);
    const options: PluginHostOptions = {
      createBag,
      activeRuntime: () => activeRuntime,
      isDisabled: (name) => stateStore.isDisabled(name),
    };
    host = new PluginHost(
      pluginDir,
      (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
      options,
    );
    manager = new PackageManager({ pluginDir, host, stateStore });
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('installs a directory package into the plugin root and activates it', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();

    const result = await manager.installFromPath({ path: source });

    expect(result).toMatchObject({
      name: 'acme',
      version: '1.0.0',
      saved: true,
      application: 'applied',
    });
    expect(result.activeRevision).toBe(host!.getClientSnapshot().revision);
    expect(result.pendingRevision).toBeUndefined();
    expect(fs.existsSync(path.join(pluginDir, 'acme', 'plugin.json'))).toBe(true);
    expect(host!.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme']);
    // The source directory is never moved or deleted.
    expect(fs.existsSync(path.join(source, 'plugin.json'))).toBe(true);
  });

  it('rejects a relative source path', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    const relative = path.relative(process.cwd(), source);
    await expect(manager.installFromPath({ path: relative })).rejects.toMatchObject({
      status: 400,
    });
    expect(fs.existsSync(path.join(pluginDir, 'acme'))).toBe(false);
  });

  it('rejects a source without plugin.json', async () => {
    const source = path.join(sourceDir, 'plain');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = {};');

    await expect(manager.installFromPath({ path: source })).rejects.toBeInstanceOf(PackageManagerError);
    await expect(manager.installFromPath({ path: source })).rejects.toMatchObject({ status: 400 });
    expect(fs.readdirSync(pluginDir)).toEqual([]);
  });

  it('rejects a manifest name that would escape the plugin root', async () => {
    const source = path.join(sourceDir, 'evil');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ name: '../escape' }));
    fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = { name: "../escape" };');

    await expect(manager.installFromPath({ path: source })).rejects.toMatchObject({ status: 400 });
    expect(fs.existsSync(path.join(base, 'escape'))).toBe(false);
    expect(fs.readdirSync(pluginDir)).toEqual([]);
  });

  it('refuses to overwrite an installed package without the flag', async () => {
    const first = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'First') });
    await host!.init();
    await manager.installFromPath({ path: first });
    const before = host!.getClientSnapshot().revision;

    fs.writeFileSync(
      path.join(first, 'index.js'),
      DECLARATIVE_MODULE('acme', 'Second'),
    );
    await expect(manager.installFromPath({ path: first })).rejects.toMatchObject({ status: 409 });

    expect(host!.getClientSnapshot().revision).toBe(before);
    expect(fs.readFileSync(path.join(pluginDir, 'acme', 'index.js'), 'utf-8')).toContain('First');
  });

  it('replaces an installed package atomically when overwrite is allowed', async () => {
    const first = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'First') });
    await host!.init();
    await manager.installFromPath({ path: first });
    const before = host!.getClientSnapshot().revision;

    fs.writeFileSync(path.join(first, 'index.js'), DECLARATIVE_MODULE('acme', 'Second'));
    const result = await manager.installFromPath({ path: first, overwrite: true });

    expect(result.application).toBe('applied');
    expect(result.activeRevision).toBe(host!.getClientSnapshot().revision);
    expect(result.activeRevision).not.toBe(before);
    expect(fs.readFileSync(path.join(pluginDir, 'acme', 'index.js'), 'utf-8')).toContain('Second');
    // No staging/backup directories may linger in the plugin root.
    expect(fs.readdirSync(pluginDir).sort()).toEqual(['acme']);
  });

  it('installs under the manifest name even when the source directory is named differently', async () => {
    const draftDir = path.join(sourceDir, 'draft-123');
    fs.mkdirSync(draftDir);
    fs.writeFileSync(path.join(draftDir, 'plugin.json'), JSON.stringify({ name: 'acme', version: '2.0.0' }));
    fs.writeFileSync(path.join(draftDir, 'index.js'), DECLARATIVE_MODULE('acme', 'Draft'));
    await host!.init();

    const result = await manager.installFromPath({ path: draftDir });

    expect(result.name).toBe('acme');
    expect(result.version).toBe('2.0.0');
    expect(fs.existsSync(path.join(pluginDir, 'acme', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'draft-123'))).toBe(false);
  });

  it('rejects a manifest entry file outside the package directory', async () => {
    const source = path.join(sourceDir, 'evil-main');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(sourceDir, 'outside.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({
      name: 'evil-main',
      main: '../outside.js',
    }));

    await expect(manager.installFromPath({ path: source })).rejects.toMatchObject({ status: 400 });
    expect(fs.readdirSync(pluginDir)).toEqual([]);
  });

  it('refuses to shadow a single-file package of the same name', async () => {
    fs.writeFileSync(path.join(pluginDir, 'acme.js'), DECLARATIVE_MODULE('acme', 'Legacy'));
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();

    await expect(manager.installFromPath({ path: source, overwrite: true })).rejects.toMatchObject({
      status: 409,
    });
    expect(fs.existsSync(path.join(pluginDir, 'acme'))).toBe(false);
  });

  it('stages a new package that owns the active runtime as pending', async () => {
    activeRuntime = 'acme-rt';
    const source = writePackage(sourceDir, 'acme-rt', { module: RUNTIME_MODULE('acme-rt') });
    await host!.init();
    const runtimeEntries: any[] = [];
    host!.bindRuntime((entries) => { runtimeEntries.length = 0; runtimeEntries.push(...entries); });
    const before = host!.getClientSnapshot().revision;

    const result = await manager.installFromPath({ path: source });

    expect(result.application).toBe('pending');
    expect(result.saved).toBe(true);
    expect(result.pendingRevision).toMatch(/^[^:]+:\d+$/);
    expect(result.activeRevision).toBeUndefined();
    expect(host!.getClientSnapshot().revision).toBe(before);
    expect(host!.getClientSnapshot().plugins).toEqual([]);
    expect(runtimeEntries).toEqual([]);
    expect(host!.getPending('acme-rt')?.revision).toBe(result.pendingRevision);

    const applied = await manager.applyPending('acme-rt');
    expect(applied.application).toBe('applied');
    expect(applied.activeRevision).toBe(host!.getClientSnapshot().revision);
    expect(host!.getClientSnapshot().revision).not.toBe(before);
    expect(host!.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme-rt']);
    expect(runtimeEntries.map((entry) => entry.name)).toEqual(['acme-rt']);
    // Applying the committed package takes over the active runtime name: the
    // route must switch/re-instantiate the runtime afterwards.
    expect(applied.runtimeSwitchRequired).toBe(true);
  });

  it('resets directory watchers after copying a package into the plugin root', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'First') });
    await host!.init();
    const resetWatchers = jest.spyOn(host!, 'resetWatchers');

    await manager.installFromPath({ path: source });
    // A new install also resets: harmless, and it guarantees the watcher is
    // rebuilt on the directory object that now exists.
    expect(resetWatchers).toHaveBeenCalledTimes(1);

    resetWatchers.mockClear();
    fs.writeFileSync(path.join(source, 'index.js'), DECLARATIVE_MODULE('acme', 'Second'));
    await manager.installFromPath({ path: source, overwrite: true });
    // Rename replacement creates a new directory object; the watcher from the
    // old one is dead even though the path string is unchanged.
    expect(resetWatchers).toHaveBeenCalledTimes(1);
  });

  it('persists disable state and skips the package until it is enabled', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();
    await manager.installFromPath({ path: source });
    const afterInstall = host!.getClientSnapshot().revision;

    const disabled = await manager.disable('acme');
    expect(disabled.saved).toBe(true);
    expect(stateStore.isDisabled('acme')).toBe(true);
    // A new store instance (gateway restart) still sees the persisted state.
    expect(new PackageStateStore(base).isDisabled('acme')).toBe(true);
    expect(host!.getClientSnapshot().plugins).toEqual([]);
    expect(host!.getClientSnapshot().revision).not.toBe(afterInstall);
    // Disable never modifies the package directory.
    expect(fs.existsSync(path.join(pluginDir, 'acme', 'plugin.json'))).toBe(true);

    const enabled = await manager.enable('acme');
    expect(enabled.saved).toBe(true);
    expect(stateStore.isDisabled('acme')).toBe(false);
    expect(host!.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme']);
  });

  it('reports unknown packages for disable, enable, reload and remove', async () => {
    await host!.init();
    for (const operation of [
      () => manager.disable('missing'),
      () => manager.enable('missing'),
      () => manager.remove('missing'),
      () => manager.reload('missing'),
    ]) {
      await expect(operation()).rejects.toMatchObject({ status: 404 });
    }
  });

  it('rejects unsafe package names for every by-name operation', async () => {
    await host!.init();
    for (const operation of [
      () => manager.disable('../escape'),
      () => manager.enable('..'),
      () => manager.remove('a/b'),
      () => manager.reload('a\\b'),
      () => manager.applyPending('..\\x'),
    ]) {
      await expect(operation()).rejects.toMatchObject({ status: 400 });
    }
  });

  it('disposes the package before deleting only its directory inside the plugin root', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();
    await manager.installFromPath({ path: source });
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');

    const result = await manager.remove('acme');

    expect(result.saved).toBe(true);
    expect(bags[0].dispose).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(pluginDir, 'acme'))).toBe(false);
    expect(host!.getClientSnapshot().plugins).toEqual([]);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf-8')).toBe('keep');
  });

  it('keeps the old active revision when an activation fails after saving', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();
    await manager.installFromPath({ path: source });
    const before = host!.getClientSnapshot().revision;

    fs.writeFileSync(path.join(source, 'index.js'), DECLARATIVE_MODULE('acme', 'Broken'));
    (globalThis as any).__mafwFail = 'acme';
    const result = await manager.installFromPath({ path: source, overwrite: true });

    expect(result.application).toBe('failed');
    expect(result.saved).toBe(true);
    expect(result.error).toMatch(/boom/);
    expect(result.activeRevision).toBe(before);
    expect(host!.getClientSnapshot().revision).toBe(before);
    expect(host!.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme']);
  });

  it('checks a candidate without publishing a revision', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    (globalThis as any).__mafwFail = 'acme';
    await host!.init();
    const before = host!.getClientSnapshot();
    const beforeState = host!.getState();
    const beforeActivations = (globalThis as any).__mafwActivations ?? 0;
    delete (globalThis as any).__mafwFail;

    const result = await manager.checkPath(source);

    expect(result).toMatchObject({
      ok: true,
      name: 'acme',
      version: '1.0.0',
      contributions: ['actions', 'ui'],
    });
    expect((globalThis as any).__mafwActivations).toBe(beforeActivations + 1);
    expect(host!.getClientSnapshot()).toBe(before);
    expect(host!.getState()).toEqual(beforeState);
    expect(bags[bags.length - 1].dispose).toHaveBeenCalledTimes(1);
    // Checking never copies the package into the plugin root.
    expect(fs.existsSync(path.join(pluginDir, 'acme'))).toBe(false);
  });

  it('reports a failed candidate activation as an unsuccessful check', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();
    const before = host!.getClientSnapshot();
    (globalThis as any).__mafwFail = 'acme';

    const result = await manager.checkPath(source);

    expect(result.ok).toBe(false);
    expect(result.name).toBe('acme');
    expect(result.error).toMatch(/boom/);
    expect(host!.getClientSnapshot()).toBe(before);
  });

  it('rejects a check of a relative or missing path', async () => {
    await host!.init();
    const relative = path.relative(process.cwd(), sourceDir);
    await expect(manager.checkPath(relative)).rejects.toMatchObject({ status: 400 });
    await expect(manager.checkPath(path.join(base, 'nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('replays an install with the same requestId instead of activating twice', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();

    const first = await manager.installFromPath({ path: source, requestId: 'req-1' });
    const activations = (globalThis as any).__mafwActivations;
    const second = await manager.installFromPath({ path: source, requestId: 'req-1' });

    expect(second).toEqual(first);
    expect((globalThis as any).__mafwActivations).toBe(activations);
  });

  it('reload keeps an active-runtime change pending instead of committing it', async () => {
    const source = writePackage(sourceDir, 'rt', { module: RUNTIME_MODULE('rt') });
    await host!.init();
    await manager.installFromPath({ path: source });
    const before = host!.getClientSnapshot().revision;

    // The gateway now runs on this package's runtime: a changed candidate must
    // wait for an explicit apply instead of replacing it mid-flight.
    activeRuntime = 'rt';
    fs.writeFileSync(path.join(pluginDir, 'rt', 'index.js'), `${RUNTIME_MODULE('rt')}\n// v2\n`);

    const reloaded = await manager.reload('rt');
    expect(reloaded.application).toBe('pending');
    expect(reloaded.pendingRevision).toBeDefined();
    expect(host!.getClientSnapshot().revision).toBe(before);
    expect(host!.getPending('rt')).not.toBeNull();

    const applied = await manager.applyPending('rt');
    expect(applied.application).toBe('applied');
    expect(host!.getPending('rt')).toBeNull();
    expect(host!.getClientSnapshot().revision).not.toBe(before);
  });

  it('reloads a single package through the host staging flow', async () => {
    const source = writePackage(sourceDir, 'acme', { module: DECLARATIVE_MODULE('acme', 'Acme') });
    await host!.init();
    await manager.installFromPath({ path: source });
    const before = host!.getClientSnapshot().revision;

    fs.writeFileSync(path.join(pluginDir, 'acme', 'index.js'), DECLARATIVE_MODULE('acme', 'Reloaded'));
    const result = await manager.reload('acme');

    expect(result.application).toBe('applied');
    expect(result.activeRevision).toBe(host!.getClientSnapshot().revision);
    expect(result.activeRevision).not.toBe(before);
  });
});
