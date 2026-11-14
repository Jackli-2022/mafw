import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import { PackageStateStore, PACKAGE_STATE_FILE } from '../../src/plugins/package-state-store';
import { PackageManager } from '../../src/plugins/package-manager';
import { PluginSafety } from '../../src/plugins/plugin-safety';
import { PluginAuditStore } from '../../src/plugins/plugin-audit-store';
import { GatewayDatabase } from '../../src/memory/gateway-db';

const MODULE = (name: string) => `
module.exports = { name: '${name}', async activate() {
  return { actions: { ping: { handler: async () => ({ ok: true }) } } };
} };
`;

function writePackage(dir: string, name: string, manifest: Record<string, unknown> = {}): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
  fs.writeFileSync(path.join(root, 'index.js'), MODULE(name));
  return root;
}

describe('Phase 6A trust surface', () => {
  let base: string;
  let pluginDir: string;
  let sourceDir: string;
  let state: PackageStateStore;
  let host: PluginHost;
  let audit: PluginAuditStore;
  let safety: PluginSafety;
  let manager: PackageManager;
  let db: GatewayDatabase;

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-trust-6a-'));
    pluginDir = path.join(base, 'plugins');
    sourceDir = path.join(base, 'sources');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    state = new PackageStateStore(base);
    db = new GatewayDatabase(path.join(base, 'gateway.db'));
    audit = new PluginAuditStore(db);
    host = new PluginHost(
      pluginDir,
      (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }),
      { isDisabled: (name) => state.isDisabled(name) },
    );
    safety = new PluginSafety({ state, host, audit });
    manager = new PackageManager({
      pluginDir,
      host,
      stateStore: state,
      audit,
    });
    await host.init();
  });

  afterEach(() => {
    host.stop();
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('installs a v1 package, records the baseline and audits the install', async () => {
    const source = writePackage(sourceDir, 'acme');
    const result = await manager.installFromPath({ path: source });

    expect(result).toMatchObject({ name: 'acme', application: 'applied', apiVersion: 1, kind: 'trusted' });
    expect(state.getInstalled('acme')?.files['index.js']).toMatch(/^sha256-/);
    expect(audit.list({ limit: 10 })[0]).toMatchObject({ action: 'install', package: 'acme', result: 'ok' });
  });

  it('kill persists safe mode across a new state store instance', async () => {
    await manager.installFromPath({ path: writePackage(sourceDir, 'acme') });
    await safety.kill({ principalKind: 'service' });

    expect(host.getClientSnapshot().plugins).toEqual([]);
    expect(new PackageStateStore(base).isSafeMode()).toBe(true);
    expect(audit.list({ limit: 10 }).some((event) => event.action === 'safe-mode.on')).toBe(true);

    await safety.resume({ principalKind: 'human' });
    expect(new PackageStateStore(base).isSafeMode()).toBe(false);
  });

  it('enters safe mode when the persisted state file is corrupt', () => {
    fs.writeFileSync(path.join(base, PACKAGE_STATE_FILE), '{ not json');
    const reloaded = new PackageStateStore(base);
    expect(reloaded.isSafeMode()).toBe(true);
    expect(reloaded.wasCorrupt()).toBe(true);
  });

  it('quarantines a package after three recorded activation failures', () => {
    safety.recordActivationFailure('acme', '1.0.0', 'boom');
    safety.recordActivationFailure('acme', '1.0.0', 'boom');
    expect(safety.recordActivationFailure('acme', '1.0.0', 'boom')).toEqual({ quarantined: true });
    expect(safety.blockedReason('acme')).toBe('quarantined');
    expect(audit.list({ limit: 10 }).some((event) => event.action === 'quarantine')).toBe(true);
  });
});
