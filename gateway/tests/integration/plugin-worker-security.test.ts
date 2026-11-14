import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { PackageManager } from '../../src/plugins/package-manager';
import { PackageStateStore } from '../../src/plugins/package-state-store';
import { WorkerHost } from '../../src/plugins/worker/worker-host';

const ECHO = path.join(__dirname, '../fixtures/plugins-worker/echo');

describe('Phase 6B worker security', () => {
  it('installs, activates and invokes an untrusted package without loading it in-process', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-worker-security-'));
    const pluginDir = path.join(base, 'plugins');
    fs.mkdirSync(pluginDir, { recursive: true });
    const state = new PackageStateStore(base);
    const host = new PluginHost(pluginDir, () => ({} as any), {
      workerAvailable: () => true,
      installedFingerprint: (name) => state.getInstalled(name)?.fingerprint,
      workerHostFactory: (desc, manifest, hooks) => new WorkerHost({
        name: desc.name,
        packageDir: desc.pkgDir!,
        entryFile: desc.mainFile,
        manifest,
        onEmit: hooks.emit,
        getConfig: () => ({}),
        updateConfig: () => {},
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      }),
    });
    await host.init();
    const manager = new PackageManager({
      pluginDir, host, stateStore: state, workerAvailable: true,
    });

    const installed = await manager.installFromPath({
      path: ECHO,
      accept: { trust: 'untrusted', permissions: ['actions', 'config.read', 'config.write'] },
    });
    expect(installed.error).toBeUndefined();
    expect(installed).toMatchObject({ name: 'echo', application: 'applied', kind: 'untrusted' });
    expect(host.getState().find((entry) => entry.name === 'echo')).toMatchObject({
      transport: 'worker', status: 'ok',
    });
    await expect(host.invokeAction('echo', 'echo', { value: 3 }, {
      signal: new AbortController().signal,
    })).resolves.toEqual({ value: 3 });
    expect(Object.keys(require.cache).some((key) => key.includes('echo/index.js'))).toBe(false);

    await host.deactivate('echo');
    host.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.rmSync(base, { recursive: true, force: true });
  });
});
