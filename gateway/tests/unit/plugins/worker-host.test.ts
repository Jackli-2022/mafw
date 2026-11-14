import * as path from 'path';
import { WorkerHost } from '../../../src/plugins/worker/worker-host';
import { SubprocessLedger } from '../../../src/kernel-v2/subprocess-ledger';

const FIXTURES = path.join(__dirname, '../../fixtures/plugins-worker');
const BOOTSTRAP = path.join(__dirname, '../../../src/plugins/worker/worker-bootstrap.cjs');

function makeWorkerHost(name: string, options: { ledger?: SubprocessLedger; permissionFlag?: any } = {}) {
  const packageDir = path.join(FIXTURES, name);
  return new WorkerHost({
    name,
    packageDir,
    entryFile: path.join(packageDir, 'index.js'),
    manifest: {
      name,
      main: 'index.js',
      apiVersion: 2,
      kind: 'untrusted',
      permissions: ['actions'],
      legacy: false,
    },
    bootstrapPath: BOOTSTRAP,
    ledger: options.ledger,
    permissionFlag: options.permissionFlag,
    onEmit: () => {},
    getConfig: () => ({}),
    updateConfig: () => {},
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('WorkerHost', () => {
  it('starts, invokes an action and stops', async () => {
    const host = makeWorkerHost('echo');
    const ready = await host.start();
    expect(ready.name).toBe('echo');
    await expect(host.invoke('echo', { value: 7 }, 2000)).resolves.toEqual({ value: 7 });
    const pid = host.getPid();
    await host.stop('test');
    expect(host.health()).toBe('stopped');
    expect(isAlive(pid!)).toBe(false);
  });

  it('records the child in the subprocess ledger', async () => {
    const ledger = new SubprocessLedger();
    const host = makeWorkerHost('echo', { ledger });
    await host.start();
    expect(ledger.snapshot().some((record) => record.id === 'plugin:echo' && record.state === 'running')).toBe(true);
    await host.stop('test');
    expect(ledger.snapshot().find((record) => record.id === 'plugin:echo')?.state).toBe('stopped');
  });

  it('rejects invokes after stop', async () => {
    const host = makeWorkerHost('echo');
    await host.start();
    await host.stop('test');
    await expect(host.invoke('echo', {})).rejects.toThrow(/not running/i);
  });

  it('refuses to start without a permission flag', async () => {
    const host = makeWorkerHost('echo', { permissionFlag: null });
    await expect(host.start()).rejects.toThrow(/worker_unavailable/);
  });
});
