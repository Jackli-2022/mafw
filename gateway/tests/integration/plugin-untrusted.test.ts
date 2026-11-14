import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { PackageManager } from '../../src/plugins/package-manager';
import { PackageStateStore } from '../../src/plugins/package-state-store';

function writePackage(dir: string): string {
  const root = path.join(dir, 'acme');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    name: 'acme',
    version: '1.0.0',
    apiVersion: 2,
    kind: 'untrusted',
    permissions: ['actions'],
  }));
  fs.writeFileSync(path.join(root, 'index.js'), "throw new Error('must not load in the gateway process');");
  return root;
}

describe('untrusted package install', () => {
  it('installs and activates an untrusted package when a worker is available', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-untrusted-'));
    const pluginDir = path.join(base, 'plugins');
    const sourceDir = path.join(base, 'sources');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    const state = new PackageStateStore(base);
    const worker = {
      start: jest.fn(async () => ({
        name: 'acme', version: '1.0.0', apiVersion: 2,
        contributions: { actions: { echo: { title: 'Echo' } } },
      })),
      invoke: jest.fn(async (_action: string, input: unknown) => input),
      stop: jest.fn(async () => {}),
    };
    const host = new PluginHost(pluginDir, () => ({} as any), {
      workerHostFactory: () => worker as any,
      workerAvailable: () => true,
    });
    await host.init();
    const manager = new PackageManager({
      pluginDir,
      host,
      stateStore: state,
      workerAvailable: true,
    });

    const result = await manager.installFromPath({
      path: writePackage(sourceDir),
      accept: { trust: 'untrusted', permissions: ['actions'] },
    });

    expect(result).toMatchObject({ name: 'acme', application: 'applied', kind: 'untrusted' });
    expect(host.getState().find((entry) => entry.name === 'acme')).toMatchObject({
      transport: 'worker', status: 'ok',
    });
    expect(Object.keys(require.cache).some((key) => key.includes('acme/index.js'))).toBe(false);

    host.stop();
    fs.rmSync(base, { recursive: true, force: true });
  });
});
