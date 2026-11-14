import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';

function writePackage(dir: string, name: string, manifest: Record<string, unknown>): void {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, ...manifest }));
  fs.writeFileSync(path.join(root, 'index.js'), `module.exports = { name: '${name}', activate() { return {}; } };`);
}

function makeHost(dir: string): PluginHost {
  return new PluginHost(dir, () => ({} as any), { hostVersion: '5.1.0' });
}

describe('plugin compatibility gate', () => {
  it('skips an apiVersion 3 package without entering safe mode', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-compat-'));
    writePackage(dir, 'future', { apiVersion: 3 });
    const host = makeHost(dir);
    await host.reload();
    expect(host.getState().find((entry) => entry.name === 'future')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('unsupported apiVersion'),
    });
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips a host-range-incompatible package', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-compat-'));
    writePackage(dir, 'old', { apiVersion: 2, host: '>=7.0.0' });
    const host = makeHost(dir);
    await host.reload();
    expect(host.getState().find((entry) => entry.name === 'old')?.error).toContain('host range');
    host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
