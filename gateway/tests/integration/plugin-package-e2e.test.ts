/**
 * Task 13 — end-to-end proof for a shipped unified plugin package.
 *
 * The example in `docs/examples/plugins/service-monitor` is installed through
 * the real PackageManager/PluginHost stack (temporary plugin home, fake
 * broadcast sink) and exercised across its whole lifecycle: check, install,
 * descriptor validation, panel/config/tool-card/message-window actions,
 * registered event broadcast, canonical-event spoofing, hot reload, disable and
 * delete.
 *
 * The second suite proves the packaged resolution story for
 * `@mafw/plugin-contract`: the built contract package is staged into a
 * simulated Desktop gateway bundle and into a simulated global npm install, and
 * `require('@mafw/plugin-contract')` is resolved by child Node processes that
 * never see the repository's workspace symlink.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PLUGIN_UI_LIMITS, validateClientDescriptor } from '@mafw/plugin-contract';
import { config } from '../../src/config';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import {
  PluginHost,
  type PluginEventFrame,
  type PluginHostOptions,
} from '../../src/plugins/package-host';
import { PackageManager } from '../../src/plugins/package-manager';
import { PackageStateStore } from '../../src/plugins/package-state-store';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'docs', 'examples', 'plugins', 'service-monitor');
const CONTRACT_DIR = path.join(REPO_ROOT, 'packages', 'plugin-contract');
const STAGER = path.join(REPO_ROOT, 'scripts', 'stage-plugin-contract.mjs');
const CHANGED_EVENT = 'plugin:service-monitor:changed';

function mergeInto(target: Record<string, any>, patch: Record<string, any>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeInto(target[key], value as Record<string, any>);
    } else {
      target[key] = value;
    }
  }
}

function collectWidgets(value: unknown, out: any[] = []): any[] {
  if (Array.isArray(value)) {
    for (const item of value) collectWidgets(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string') out.push(record);
  for (const child of Object.values(record)) collectWidgets(child, out);
  return out;
}

function writeRuntimeFixture(dir: string, name = 'service-runtime'): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0' }));
  fs.writeFileSync(
    path.join(root, 'index.js'),
    `module.exports = {
  name: '${name}',
  async activate() {
    return {
      runtime: {
        name: '${name}',
        async createRuntime() {
          return { name: '${name}', capabilities: {} };
        },
      },
    };
  },
};
`,
  );
  return root;
}

describe('service-monitor example package (end-to-end)', () => {
  let base: string;
  let pluginDir: string;
  let sourceDir: string;
  let stateStore: PackageStateStore;
  let host: PluginHost;
  let manager: PackageManager;
  let frames: PluginEventFrame[];
  let persistCalls: Array<Record<string, unknown>>;
  let activeRuntime: string | null;
  let originalConfigData: unknown;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-e2e-'));
    pluginDir = path.join(base, 'plugins');
    sourceDir = path.join(base, 'sources');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    frames = [];
    persistCalls = [];
    activeRuntime = null;
    originalConfigData = (config as any).data;
    (config as any).data = {};
    stateStore = new PackageStateStore(base);
    const options: PluginHostOptions = {
      activeRuntime: () => activeRuntime,
      isDisabled: (name) => stateStore.isDisabled(name),
      canonicalTypes: new Set(['turn.completed']),
      broadcast: (event) => { frames.push(event); },
    };
    host = new PluginHost(
      pluginDir,
      (name) => createPluginPackageContext(name, {
        projectDir: base,
        gatewayPort: 3000,
        persistConfig: (overrides) => {
          persistCalls.push(overrides as Record<string, unknown>);
          mergeInto((config as any).data, overrides as Record<string, any>);
        },
      }),
      options,
    );
    manager = new PackageManager({ pluginDir, host, stateStore });
  });

  afterEach(() => {
    host.stop();
    (config as any).data = originalConfigData;
    fs.rmSync(base, { recursive: true, force: true });
  });

  function descriptor() {
    const snapshot = host.getClientSnapshot();
    expect(snapshot.plugins).toHaveLength(1);
    return snapshot.plugins[0];
  }

  it('installs, activates and projects the validated descriptor', async () => {
    await host.reload();

    const check = await manager.checkPath(EXAMPLE_DIR);
    expect(check).toMatchObject({
      ok: true,
      name: 'service-monitor',
      version: '1.0.0',
      contributions: ['actions', 'events', 'ui'],
    });
    // A check never installs or publishes anything.
    expect(host.getClientSnapshot().plugins).toEqual([]);

    const installed = await manager.installFromPath({ path: EXAMPLE_DIR });
    expect(installed).toMatchObject({
      name: 'service-monitor',
      version: '1.0.0',
      saved: true,
      application: 'applied',
    });
    expect(installed.activeRevision).toBe(host.getClientSnapshot().revision);
    expect(fs.existsSync(path.join(pluginDir, 'service-monitor', 'plugin.json'))).toBe(true);

    const plugin = descriptor();
    expect(plugin.revision).toBe(installed.activeRevision);
    expect(plugin.version).toBe('1.0.0');
    // The Host projects a descriptor the shared contract accepts as-is.
    expect(validateClientDescriptor(plugin)).toMatchObject({ ok: true });

    expect(plugin.ui.panels).toEqual([
      {
        id: 'overview',
        title: 'Service Monitor',
        icon: 'activity',
        order: 40,
        viewAction: 'refresh',
        refreshOn: [CHANGED_EVENT],
      },
    ]);
    expect(plugin.ui.configPages?.[0]).toMatchObject({
      id: 'settings',
      title: 'Service Monitor settings',
      loadAction: 'loadConfig',
      saveAction: 'saveConfig',
      schema: {
        type: 'object',
        required: ['endpoint', 'intervalSeconds', 'verbose'],
        additionalProperties: false,
      },
    });
    expect(Object.keys(plugin.ui.configPages?.[0].schema.properties ?? {}).sort()).toEqual([
      'endpoint',
      'intervalSeconds',
      'verbose',
    ]);
    expect(plugin.ui.toolCards).toEqual([
      { id: 'service-tool', tools: ['bash', 'shell'], override: true, viewAction: 'toolCard' },
    ]);
    expect(plugin.ui.messageWindows?.[0]).toMatchObject({
      id: 'status-change',
      title: 'Service status changed',
      triggerEvent: CHANGED_EVENT,
      viewAction: 'messageView',
      modal: false,
      dismissible: true,
    });
    expect(plugin.actions.map((entry) => entry.name).sort()).toEqual([
      'loadConfig',
      'messageView',
      'refresh',
      'saveConfig',
      'toolCard',
    ]);
    expect(plugin.events).toEqual([
      expect.objectContaining({ type: CHANGED_EVENT, scope: 'global' }),
    ]);
  });

  it('runs every action and broadcasts only registered package events', async () => {
    await host.reload();
    await manager.installFromPath({ path: EXAMPLE_DIR });

    const view = await host.invokeAction('service-monitor', 'refresh', {}) as any;
    expect(view.title).toBe('Service Monitor');
    expect(view.subtitle).toContain('every 60s');
    expect(Array.isArray(view.body)).toBe(true);
    expect(view.body.length).toBeGreaterThan(0);
    const widgets = collectWidgets(view.body);
    const actionWidget = widgets.find((widget) => widget.type === 'action');
    expect(actionWidget).toMatchObject({ action: 'refresh', style: 'primary' });
    expect(widgets.some((widget) => widget.type === 'progress')).toBe(true);

    const changed = frames.filter((frame) => frame.type === CHANGED_EVENT);
    // The panel viewAction refreshes on CHANGED_EVENT, so it must not emit it.
    expect(changed).toHaveLength(0);

    const loaded = await host.invokeAction('service-monitor', 'loadConfig', {});
    expect(loaded).toEqual({
      endpoint: 'https://status.example.com',
      intervalSeconds: 60,
      verbose: false,
    });

    const saved = await host.invokeAction('service-monitor', 'saveConfig', {
      endpoint: 'https://status.internal',
      intervalSeconds: 15,
      verbose: true,
    });
    expect(saved).toEqual({
      saved: true,
      config: {
        endpoint: 'https://status.internal',
        intervalSeconds: 15,
        verbose: true,
      },
    });
    expect(persistCalls).toEqual([
      {
        plugins: {
          'service-monitor': {
            config: {
              endpoint: 'https://status.internal',
              intervalSeconds: 15,
              verbose: true,
            },
          },
        },
      },
    ]);
    const changedAfterSave = frames.filter((frame) => frame.type === CHANGED_EVENT);
    expect(changedAfterSave).toHaveLength(1);
    expect(changedAfterSave[0].properties).toMatchObject({ checked: 1, source: 'saveConfig' });
    expect(typeof changedAfterSave[0].properties?.at).toBe('string');
    expect(changedAfterSave[0].sessionID).toBeUndefined();

    const card = await host.invokeAction('service-monitor', 'toolCard', {
      tool: 'bash',
      status: 'completed',
      input: { command: 'npm test' },
      output: 'ok',
    }) as any;
    expect(card.title).toContain('bash');
    expect(JSON.stringify(card)).toContain('npm test');
    expect(collectWidgets(card.body).some((widget) => widget.type === 'code')).toBe(true);

    const message = await host.invokeAction('service-monitor', 'messageView', {
      event: {
        type: CHANGED_EVENT,
        properties: {
          checked: 2,
          at: '2026-11-03T00:00:00.000Z',
          source: 'saveConfig',
        },
      },
    }) as any;
    expect(message.title).toBe('Service status changed');
    expect(JSON.stringify(message.body)).toContain('**2**');
    expect(JSON.stringify(message.body)).toContain('saveConfig');
    // The message window reads the current config, not a baked default endpoint.
    expect(JSON.stringify(message.body)).toContain('https://status.internal');
    expect(collectWidgets(message.body).some((widget) => widget.type === 'markdown')).toBe(true);

    // Canonical names, unregistered names and foreign namespaces never reach
    // the broadcast sink, even through the package's own registry entry.
    const before = frames.length;
    const registry = host.getEventRegistry();
    expect(registry.emit('service-monitor', 'turn.completed', {})).toMatchObject({
      ok: false,
      error: 'canonical-event',
    });
    expect(registry.emit('service-monitor', 'plugin:service-monitor:not-registered', {})).toMatchObject({
      ok: false,
      error: 'unregistered-event',
    });
    expect(registry.emit('service-monitor', 'plugin:other-package:changed', {})).toMatchObject({
      ok: false,
      error: 'foreign-namespace',
    });
    expect(frames).toHaveLength(before);
  });

  it('never lets the panel viewAction emit its own refreshOn event', async () => {
    await host.reload();
    await manager.installFromPath({ path: EXAMPLE_DIR });
    const panel = descriptor().ui.panels?.[0];
    expect(panel).toBeDefined();
    expect(panel!.viewAction).toBe('refresh');
    expect(panel!.refreshOn).toEqual([CHANGED_EVENT]);

    const before = frames.length;
    // Two view loads would already be a visible feedback loop if the viewAction
    // emitted CHANGED_EVENT (Desktop re-invokes the viewAction per event).
    await host.invokeAction('service-monitor', panel!.viewAction, {});
    await host.invokeAction('service-monitor', panel!.viewAction, {});
    expect(frames).toHaveLength(before);
    expect(frames.filter((frame) => frame.type === CHANGED_EVENT)).toEqual([]);
  });

  it('hot reloads a changed package under a new revision', async () => {
    await host.reload();
    await manager.installFromPath({ path: EXAMPLE_DIR });
    const before = host.getClientSnapshot();

    const installedFile = path.join(pluginDir, 'service-monitor', 'index.js');
    const original = fs.readFileSync(installedFile, 'utf8');
    expect(original).toContain("const PANEL_TITLE = 'Service Monitor'");
    fs.writeFileSync(
      installedFile,
      original.replace("const PANEL_TITLE = 'Service Monitor'", "const PANEL_TITLE = 'Service Monitor v2'"),
    );
    // Jest keeps its own module registry; clearing it makes the reload test the
    // new file content instead of the cached module (Node evicts require.cache
    // in the Host).
    jest.resetModules();

    const reloaded = await manager.reload('service-monitor');
    expect(reloaded.application).toBe('applied');
    expect(reloaded.activeRevision).toBeDefined();
    expect(reloaded.activeRevision).not.toBe(before.revision);

    const after = host.getClientSnapshot();
    expect(after.revision).toBe(reloaded.activeRevision);
    expect(after.plugins[0].ui.panels?.[0].title).toBe('Service Monitor v2');
    const view = await host.invokeAction('service-monitor', 'refresh', {}) as any;
    expect(view.title).toBe('Service Monitor v2');
  });

  it('drops every action and event registration on disable and delete', async () => {
    await host.reload();
    await manager.installFromPath({ path: EXAMPLE_DIR });
    expect(host.getActionRegistry().hasPackage('service-monitor')).toBe(true);
    expect(host.getEventRegistry().has('service-monitor', CHANGED_EVENT)).toBe(true);

    const disabled = await manager.disable('service-monitor');
    expect(disabled).toMatchObject({ saved: true, enabled: false, application: 'applied' });
    expect(host.getClientSnapshot().plugins).toEqual([]);
    expect(host.getActionRegistry().hasPackage('service-monitor')).toBe(false);
    expect(host.getEventRegistry().has('service-monitor', CHANGED_EVENT)).toBe(false);
    await expect(host.invokeAction('service-monitor', 'refresh', {})).rejects.toMatchObject({
      code: 'unknown-package',
    });
    const before = frames.length;
    expect(host.getEventRegistry().emit('service-monitor', CHANGED_EVENT, {
      checked: 1,
      at: '2026-11-03T00:00:00.000Z',
    })).toMatchObject({ ok: false, error: 'unloaded' });
    expect(frames).toHaveLength(before);

    // Re-enabling restores the committed surface, then delete removes it again.
    const enabled = await manager.enable('service-monitor');
    expect(enabled.application).toBe('applied');
    expect(host.getActionRegistry().hasPackage('service-monitor')).toBe(true);
    expect(host.getEventRegistry().has('service-monitor', CHANGED_EVENT)).toBe(true);

    const removed = await manager.remove('service-monitor');
    expect(removed.saved).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'service-monitor'))).toBe(false);
    expect(host.getClientSnapshot().plugins).toEqual([]);
    expect(host.getActionRegistry().hasPackage('service-monitor')).toBe(false);
    expect(host.getEventRegistry().has('service-monitor', CHANGED_EVENT)).toBe(false);
  });

  it('stages a runtime-owning install as pending until apply', async () => {
    activeRuntime = 'service-runtime';
    const source = writeRuntimeFixture(sourceDir);
    await host.reload();

    const installed = await manager.installFromPath({ path: source });
    expect(installed).toMatchObject({
      name: 'service-runtime',
      saved: true,
      application: 'pending',
    });
    expect(installed.activeRevision).toBeUndefined();
    expect(installed.pendingRevision).toMatch(/^[^:]+:\d+$/);
    expect(host.getClientSnapshot().plugins).toEqual([]);
    expect(host.getPending('service-runtime')?.revision).toBe(installed.pendingRevision);

    const applied = await manager.applyPending('service-runtime');
    expect(applied.application).toBe('applied');
    expect(applied.activeRevision).toBe(host.getClientSnapshot().revision);
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['service-runtime']);
  });
});

describe('packaged @mafw/plugin-contract resolution', () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-contract-stage-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function stage(nodeModulesDir: string, args: string[] = []) {
    return spawnSync(
      process.execPath,
      [STAGER, '--source', CONTRACT_DIR, '--node-modules', nodeModulesDir, ...args],
      { encoding: 'utf8' },
    );
  }

  function writeProbe(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `const contract = require('@mafw/plugin-contract');
const ok = typeof contract.validateClientDescriptor === 'function'
  && typeof contract.normalizePluginView === 'function'
  && typeof contract.validateConfigFormSchema === 'function'
  && contract.PLUGIN_UI_LIMITS.maxDepth === ${PLUGIN_UI_LIMITS.maxDepth};
if (!ok) {
  console.error('contract exports are incomplete');
  process.exit(2);
}
console.log(JSON.stringify({ resolved: require.resolve('@mafw/plugin-contract') }));
`,
    );
  }

  function runProbe(file: string) {
    return spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: path.dirname(file) });
  }

  function expectedContractEntry(nodeModulesDir: string): string {
    return path.resolve(path.join(nodeModulesDir, '@mafw', 'plugin-contract', 'dist', 'index.js'));
  }

  it('resolves from a simulated Desktop gateway bundle', () => {
    const bundle = path.join(base, 'gateway-bundle');
    const nodeModules = path.join(bundle, 'node_modules');
    const probe = path.join(bundle, 'dist', 'plugins', 'probe.cjs');
    writeProbe(probe);

    // Without staging, the bundle cannot reach the repository workspace link.
    const before = runProbe(probe);
    expect(before.status).not.toBe(0);
    expect(before.stderr).toContain('Cannot find module \'@mafw/plugin-contract\'');

    const staged = stage(nodeModules);
    expect(staged.status).toBe(0);
    expect(staged.stdout).toContain('staged @mafw/plugin-contract');
    expect(fs.existsSync(expectedContractEntry(nodeModules))).toBe(true);

    const after = runProbe(probe);
    expect(after.status).toBe(0);
    const resolved = JSON.parse(after.stdout) as { resolved: string };
    expect(path.resolve(resolved.resolved)).toBe(expectedContractEntry(nodeModules));
  });

  it('resolves from a simulated packed global install', () => {
    const pkgRoot = path.join(base, 'prefix', 'node_modules', '@jack200714', 'mafw');
    const nodeModules = path.join(pkgRoot, 'node_modules');
    const probe = path.join(pkgRoot, 'gateway', 'dist', 'probe.cjs');
    writeProbe(probe);

    const before = runProbe(probe);
    expect(before.status).not.toBe(0);

    const staged = stage(nodeModules);
    expect(staged.status).toBe(0);
    const after = runProbe(probe);
    expect(after.status).toBe(0);
    const resolved = JSON.parse(after.stdout) as { resolved: string };
    expect(path.resolve(resolved.resolved)).toBe(expectedContractEntry(nodeModules));
  });

  it('keeps an existing workspace link instead of replacing it', () => {
    const nodeModules = path.join(base, 'workspace', 'node_modules');
    fs.mkdirSync(path.join(nodeModules, '@mafw'), { recursive: true });
    const link = path.join(nodeModules, '@mafw', 'plugin-contract');
    fs.symlinkSync(CONTRACT_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');

    const staged = stage(nodeModules);
    expect(staged.status).toBe(0);
    expect(staged.stdout).toContain('workspace link kept');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.realpathSync(link))).toBe(path.resolve(CONTRACT_DIR));
  });

  it('fails on a missing built contract unless the caller allows it', () => {
    const emptySource = path.join(base, 'empty-contract');
    const nodeModules = path.join(base, 'missing', 'node_modules');
    fs.mkdirSync(emptySource, { recursive: true });

    const strict = spawnSync(
      process.execPath,
      [STAGER, '--source', emptySource, '--node-modules', nodeModules],
      { encoding: 'utf8' },
    );
    expect(strict.status).not.toBe(0);
    expect(strict.stderr).toContain('built package missing');

    const allowed = spawnSync(
      process.execPath,
      [STAGER, '--source', emptySource, '--node-modules', nodeModules, '--allow-missing'],
      { encoding: 'utf8' },
    );
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain('skip');
    expect(fs.existsSync(path.join(nodeModules, '@mafw', 'plugin-contract'))).toBe(false);
  });

  it('is wired into the desktop bundle, deploy script, postinstall and CI', () => {
    const stageGateway = fs.readFileSync(
      path.join(REPO_ROOT, 'packages', 'desktop', 'scripts', 'stage-gateway.ts'),
      'utf8',
    );
    expect(stageGateway).toContain('stagePluginContract');
    expect(stageGateway).toContain('node_modules');

    const deploy = fs.readFileSync(path.join(REPO_ROOT, 'gateway', 'scripts', 'deploy-local.mjs'), 'utf8');
    expect(deploy).toContain('stagePluginContract');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(rootPkg.scripts.postinstall).toContain('stage-plugin-contract.mjs');
    expect(rootPkg.files).toContain('scripts/stage-plugin-contract.mjs');
    expect(rootPkg.files).toContain('packages/plugin-contract/dist/');

    const gatewayPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'gateway', 'package.json'), 'utf8'));
    expect(gatewayPkg.mafw.bundledPackages['@mafw/plugin-contract']).toBe('../packages/plugin-contract');

    for (const workspace of ['gateway-sdk', 'desktop']) {
      const workspacePkg = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'packages', workspace, 'package.json'), 'utf8'),
      );
      expect(workspacePkg.dependencies['@mafw/plugin-contract']).toBe('*');
    }

    const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('test:plugin-contract');
    expect(ci).toContain('test:plugin-example');
    expect(ci).toContain('verify:plugin-contract');
  });
});
