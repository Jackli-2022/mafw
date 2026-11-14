import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkerHost } from '../../../src/plugins/worker/worker-host';

const FIXTURES = path.join(__dirname, '../../fixtures/plugins-worker');
const BOOTSTRAP = path.join(__dirname, '../../../src/plugins/worker/worker-bootstrap.cjs');

function makeWorkerHost(name: string, config: Record<string, unknown> = {}) {
  const packageDir = path.join(FIXTURES, name);
  const updates: Record<string, unknown>[] = [];
  const host = new WorkerHost({
    name,
    packageDir,
    entryFile: path.join(packageDir, 'index.js'),
    manifest: {
      name,
      main: 'index.js',
      apiVersion: 2,
      kind: 'untrusted',
      permissions: ['actions', 'config.read', 'config.write'],
      legacy: false,
    },
    bootstrapPath: BOOTSTRAP,
    onEmit: () => {},
    getConfig: () => config,
    updateConfig: (patch) => { updates.push(patch); },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  return { host, updates };
}

describe('untrusted worker sandbox', () => {
  it('denies fs access outside the package root', async () => {
    const secret = path.join(os.tmpdir(), `mafw-worker-secret-${process.pid}.txt`);
    fs.writeFileSync(secret, 'secret');
    const { host } = makeWorkerHost('malicious-fs');
    await host.start();
    try {
      const result: any = await host.invoke('read', { path: secret }, 2000);
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/access|denied|permission/i) });
    } finally {
      await host.stop('test');
      fs.rmSync(secret, { force: true });
    }
  });

  it('denies net, child_process and fetch', async () => {
    const { host } = makeWorkerHost('malicious-net');
    await host.start();
    await expect(host.invoke('net', {}, 2000)).resolves.toMatchObject({ ok: false });
    await expect(host.invoke('child', {}, 2000)).resolves.toMatchObject({ ok: false });
    await expect(host.invoke('fetch', {}, 2000)).resolves.toMatchObject({ ok: false });
    await host.stop('test');
  });

  it('exposes config through the host and hides files', async () => {
    const { host, updates } = makeWorkerHost('config-echo', { endpoint: 'x' });
    await host.start();
    await expect(host.invoke('roundTrip', { value: 1 }, 2000)).resolves.toEqual({
      input: { value: 1 },
      config: { endpoint: 'x' },
      hasFiles: 'undefined',
    });
    expect(updates).toEqual([{ seen: { value: 1 } }]);
    await host.stop('test');
  });

  it('rejects tools / observers / ui declarations', async () => {
    const { host } = makeWorkerHost('forbidden-tools');
    await expect(host.start()).rejects.toThrow(/not allowed in untrusted worker/i);
  });
});
