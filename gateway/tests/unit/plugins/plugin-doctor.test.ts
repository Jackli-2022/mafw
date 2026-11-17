import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageStateStore } from '../../../src/plugins/package-state-store';
import { PluginDoctor } from '../../../src/plugins/plugin-doctor';

function writePackage(dir: string, name: string, manifest: Record<string, unknown>): void {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, ...manifest }));
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = { name, activate() { return {}; } };');
}

function makeDoctor(options: {
  hostVersion?: string;
  contractVersion?: string;
  state?: PackageStateStore;
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-doctor-'));
  const state = options.state ?? new PackageStateStore(dir);
  const host = {
    checkPackage: jest.fn(async () => ({ ok: true })),
    getState: jest.fn(() => []),
  };
  const doctor = new PluginDoctor({
    pluginDir: dir,
    host,
    state,
    hostVersion: options.hostVersion ?? '5.1.0',
    contractVersion: options.contractVersion,
  });
  return { doctor, dir, state, host };
}

describe('PluginDoctor', () => {
  it('passes a healthy v1 package and warns about legacy permissions', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { version: '1.0.0' });
    const report = await doctor.check('acme');
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'permissions')).toMatchObject({
      status: 'warn',
    });
  });

  it('surfaces manifest warnings such as legacy-contributes', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { contributes: { gateway: { actions: 'ping' } } });
    const report = await doctor.check('acme');
    const warnings = report.checks.find((entry) => entry.id === 'manifest-warnings');
    expect(warnings?.status).toBe('warn');
    expect(warnings?.message).toContain('legacy-contributes');
    // warn is diagnostic only: report.ok is derived from `fail` statuses.
    expect(report.ok).toBe(true);
  });

  it('adds no manifest-warnings check for a clean manifest', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { version: '1.0.0' });
    const report = await doctor.check('acme');
    expect(report.checks.find((entry) => entry.id === 'manifest-warnings')).toBeUndefined();
  });

  it('warns that desktop contributions are not enforced by this host', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { apiVersion: 2, contributes: { desktop: { ui: {} } } });
    const report = await doctor.check('acme');
    expect(report.checks.find((entry) => entry.id === 'contributes-desktop')?.status).toBe('warn');
    // Unenforceable is a visibility gap, not a package defect.
    expect(report.ok).toBe(true);
  });

  it('adds no contributes-desktop check without a desktop declaration', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { version: '1.0.0' });
    const report = await doctor.check('acme');
    expect(report.checks.find((entry) => entry.id === 'contributes-desktop')).toBeUndefined();
  });

  it('fails an unsupported apiVersion without throwing', async () => {
    const { doctor, dir } = makeDoctor();
    writePackage(dir, 'acme', { apiVersion: 3 });
    const report = await doctor.check('acme');
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'api-version')?.status).toBe('fail');
  });

  it('fails an incompatible host range', async () => {
    const { doctor, dir } = makeDoctor({ hostVersion: '5.1.0' });
    writePackage(dir, 'acme', { apiVersion: 2, host: '>=7.0.0' });
    const report = await doctor.check('acme');
    expect(report.checks.find((check) => check.id === 'host-range')?.status).toBe('fail');
  });

  it('does not dry-run activation for a quarantined package', async () => {
    const { doctor, dir, state, host } = makeDoctor();
    writePackage(dir, 'acme', {});
    state.setQuarantine({ name: 'acme', reason: 'x', at: '2026-11-14T00:00:00.000Z' });
    const report = await doctor.check('acme');
    expect(report.checks.find((check) => check.id === 'activation')?.status).toBe('warn');
    expect(host.checkPackage).not.toHaveBeenCalled();
  });

  it('synthesizes a legacy single-file manifest', async () => {
    const { doctor, dir } = makeDoctor();
    fs.writeFileSync(path.join(dir, 'legacy.js'), 'module.exports = { name: "legacy" };');
    const report = await doctor.check('legacy');
    expect(report).toMatchObject({ name: 'legacy', version: '0.0.0' });
    expect(report.checks.find((check) => check.id === 'manifest')?.status).toBe('warn');
  });

  it('warns on deprecation and contract skew', async () => {
    const { doctor, dir } = makeDoctor({ contractVersion: '9.9.9' });
    writePackage(dir, 'acme', { apiVersion: 2, deprecated: 'use acme-next' });
    const report = await doctor.check('acme');
    expect(report.checks.find((check) => check.id === 'deprecation')?.status).toBe('warn');
    expect(report.checks.find((check) => check.id === 'contract-skew')?.status).toBe('warn');
  });
});
