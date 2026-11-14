import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkerHost } from '../../../src/plugins/worker/worker-host';
import { PluginSafety } from '../../../src/plugins/plugin-safety';
import { PackageStateStore } from '../../../src/plugins/package-state-store';

const FIXTURES = path.join(__dirname, '../../fixtures/plugins-worker');
const BOOTSTRAP = path.join(__dirname, '../../../src/plugins/worker/worker-bootstrap.cjs');

function makeSafety() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-worker-safety-'));
  const state = new PackageStateStore(dir);
  const safety = new PluginSafety({
    state,
    host: { deactivate: async () => true, deactivateAll: async () => [] },
    audit: { append: () => true },
  });
  return { safety, state, dir };
}

function makeWorkerHost(name: string, options: { onCrash?: (info: any) => void } = {}) {
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
    backoffMs: [5, 5, 5],
    onCrash: options.onCrash,
    onEmit: () => {},
    getConfig: () => ({}),
    updateConfig: () => {},
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('worker resilience', () => {
  it('kills an action that exceeds its timeout and restarts', async () => {
    const host = makeWorkerHost('cpu-hog');
    await host.start();
    await expect(host.invoke('spin', {}, 100)).rejects.toThrow(/worker_timeout/);
    await waitFor(() => host.health() === 'healthy');
    expect(host.getRestarts()).toBeGreaterThanOrEqual(1);
    await host.stop('test');
  });

  it('restarts with backoff and quarantines after three crashes', async () => {
    const { safety, dir } = makeSafety();
    const host = makeWorkerHost('crash-loop', {
      onCrash: () => { safety.recordActivationFailure('crash-loop', '1.0.0', 'worker crashed'); },
    });
    await host.start();
    for (let i = 0; i < 3; i += 1) {
      await expect(host.invoke('crash', {}, 500)).rejects.toThrow();
      await waitFor(() => host.health() === 'healthy');
    }
    await waitFor(() => safety.blockedReason('crash-loop') === 'quarantined');
    expect(safety.blockedReason('crash-loop')).toBe('quarantined');
    await host.stop('test');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects an oversized result without killing the worker', async () => {
    const host = makeWorkerHost('message-bomb');
    await host.start();
    await expect(host.invoke('bomb', {}, 1000)).rejects.toThrow(/message_too_large/);
    await expect(host.invoke('echo', { ok: true }, 1000)).resolves.toEqual({ ok: true });
    await host.stop('test');
  });
});
