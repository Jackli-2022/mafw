import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageManager } from '../../../src/plugins/package-manager';
import { PackageStateStore } from '../../../src/plugins/package-state-store';
import { PluginSafety } from '../../../src/plugins/plugin-safety';

function makeManager() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-manager-safety-'));
  const pluginDir = path.join(base, 'plugins');
  const sourceDir = path.join(base, 'sources');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  const state = new PackageStateStore(base);
  const safety = new PluginSafety({
    state,
    host: { deactivate: async () => true, deactivateAll: async () => [] },
    audit: { append: () => true },
  });
  const host = {
    reload: jest.fn(async () => {}),
    getClientSnapshot: () => ({ revision: 'boot:1', plugins: [] }),
    getState: () => [],
    stageNewPackage: jest.fn(),
    resetWatchers: jest.fn(),
    checkPackage: jest.fn(async () => ({ ok: true })),
  };
  const manager = new PackageManager({
    pluginDir,
    host: host as any,
    stateStore: state,
    safety,
  });
  return { base, pluginDir, sourceDir, state, safety, manager };
}

function writeSource(sourceDir: string, name: string): string {
  const root = path.join(sourceDir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'index.js'), `module.exports = { name: '${name}', activate() { return {}; } };`);
  return root;
}

describe('PackageManager safety guards', () => {
  it('rejects installs and reloads in safe mode', async () => {
    const { base, sourceDir, state, manager } = makeManager();
    const source = writeSource(sourceDir, 'acme');
    state.setSafeMode(true);
    await expect(manager.installFromPath({ path: source }))
      .rejects.toMatchObject({ status: 409, code: 'safe_mode_active' });
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('rejects reload and apply while quarantined', async () => {
    const { base, pluginDir, state, manager } = makeManager();
    const root = path.join(pluginDir, 'acme');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'acme', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'index.js'), `module.exports = { name: 'acme', activate() { return {}; } };`);
    state.setQuarantine({ name: 'acme', reason: 'test', at: new Date().toISOString() });

    await expect(manager.reload('acme'))
      .rejects.toMatchObject({ status: 409, code: 'plugin_quarantined' });
    await expect(manager.applyPending('acme'))
      .rejects.toMatchObject({ status: 409, code: 'plugin_quarantined' });
    fs.rmSync(base, { recursive: true, force: true });
  });
});
