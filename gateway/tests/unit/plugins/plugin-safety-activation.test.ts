import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { PackageStateStore } from '../../../src/plugins/package-state-store';

function writePackage(dir: string, name: string): void {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'index.js'), `module.exports = { name: '${name}', activate() { return { actions: { ping: { handler: async () => ({ ok: true }) } } }; } };`);
}

describe('PluginHost safety activation gate', () => {
  it('does not activate packages in safe mode or quarantine', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-safety-gate-'));
    const state = new PackageStateStore(dir);
    writePackage(dir, 'acme');
    const host = new PluginHost(dir, () => ({} as any), {
      isDisabled: (name) => state.isDisabled(name),
      activationBlocked: (name) => {
        if (state.isSafeMode()) return 'safe-mode';
        return state.getQuarantine(name) ? 'quarantined' : null;
      },
    });

    await host.reload();
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme']);

    state.setSafeMode(true);
    await host.reload();
    expect(host.getClientSnapshot().plugins).toEqual([]);

    state.setSafeMode(false);
    state.setQuarantine({ name: 'acme', reason: 'test', at: new Date().toISOString() });
    await host.reload();
    expect(host.getClientSnapshot().plugins).toEqual([]);

    state.clearQuarantine('acme');
    await host.reload();
    expect(host.getClientSnapshot().plugins.map((plugin) => plugin.name)).toEqual(['acme']);

    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
