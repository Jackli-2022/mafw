import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';

function writePackage(dir: string, name: string, kind = 'untrusted'): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    main: 'index.js',
    apiVersion: 2,
    kind,
    permissions: ['actions'],
  }));
  fs.writeFileSync(path.join(root, 'index.js'), "throw new Error('must not require untrusted entry in the gateway process');");
  return root;
}

function makeHost(options: {
  contributions?: Record<string, unknown>;
  installedFingerprint?: string;
  onUntrustedDrift?: (name: string, reason: string) => void;
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-host-worker-'));
  const worker = {
    start: jest.fn(async () => ({
      name: 'acme',
      version: '1.0.0',
      apiVersion: 2,
      contributions: options.contributions ?? { actions: { echo: { title: 'Echo' } } },
      pid: 1234,
    })),
    invoke: jest.fn(async (_action: string, input: unknown) => input),
    stop: jest.fn(async () => {}),
    health: jest.fn(() => 'healthy' as const),
    getPid: () => 1234,
    getRestarts: () => 0,
  };
  const host = new PluginHost(
    dir,
    () => ({} as any),
    {
      workerHostFactory: () => worker as any,
      workerAvailable: () => true,
      installedFingerprint: () => options.installedFingerprint,
      onUntrustedDrift: options.onUntrustedDrift,
    },
  );
  return { host, worker, dir };
}

describe('PluginHost untrusted activation', () => {
  it('activates an untrusted package in a worker, not in-process', async () => {
    const { host, dir, worker } = makeHost();
    writePackage(dir, 'acme');
    await host.reload();
    const state = host.getState().find((entry) => entry.name === 'acme');
    expect(state).toMatchObject({ transport: 'worker', status: 'ok', kind: 'untrusted' });
    expect(state?.error).toBeUndefined();
    expect(worker.start).toHaveBeenCalled();
    expect(Object.keys(require.cache).some((key) => key.includes('acme/index.js'))).toBe(false);
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('registers worker actions through the host action registry', async () => {
    const { host, dir, worker } = makeHost();
    writePackage(dir, 'acme');
    await host.reload();
    await expect(host.invokeAction('acme', 'echo', { value: 1 }, {
      signal: new AbortController().signal,
    })).resolves.toEqual({ value: 1 });
    expect(worker.invoke).toHaveBeenCalledWith('echo', { value: 1 }, undefined);
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a worker that declares tools', async () => {
    const { host, dir } = makeHost({ contributions: { tools: { shell: {} } } });
    writePackage(dir, 'acme');
    await host.reload();
    expect(host.getState().find((entry) => entry.name === 'acme')).toMatchObject({ status: 'error' });
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quarantines an untrusted package whose fingerprint changed on disk', async () => {
    const drift: string[] = [];
    const { host, dir } = makeHost({
      installedFingerprint: 'sha256:old',
      onUntrustedDrift: (name, reason) => drift.push(`${name}:${reason}`),
    });
    writePackage(dir, 'acme');
    await host.reload();
    expect(drift[0]).toContain('acme');
    expect(host.getState().find((entry) => entry.name === 'acme')).toMatchObject({ status: 'error' });
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
