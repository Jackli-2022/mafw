import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageLastGoodStore } from '../../src/plugins/package-last-good';
import { PackageStateStore, PACKAGE_STATE_FILE } from '../../src/plugins/package-state-store';
import { PluginSafety } from '../../src/plugins/plugin-safety';
import { verifyDeclaredIntegrity } from '../../src/plugins/package-integrity';
import { PluginHost } from '../../src/plugins/package-host';
import { isHostRangeCompatible } from '../../src/plugins/package-manifest';

function temp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mafw-drill-${prefix}-`));
}

function writePackage(dir: string, name: string, content: string, manifest: Record<string, unknown> = {}): void {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
  fs.writeFileSync(path.join(root, 'index.js'), content);
}

function makeSafety(dir: string, lastGood?: { snapshot: any; restore: any }) {
  const state = new PackageStateStore(dir);
  return {
    state,
    safety: new PluginSafety({
      state,
      host: { deactivate: async () => true, deactivateAll: async () => [] },
      audit: { append: () => true },
      lastGood,
      autoConfirm: false,
    }),
  };
}

async function scenarioLastGood(prefix: string): Promise<boolean> {
  const dir = temp(prefix);
  writePackage(dir, 'acme', 'old');
  const store = new PackageLastGoodStore(dir);
  if (!store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' })) return false;
  fs.writeFileSync(path.join(dir, 'acme', 'index.js'), 'new');
  const ok = store.restore('acme') && fs.readFileSync(path.join(dir, 'acme', 'index.js'), 'utf8') === 'old';
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

async function scenarioHealthRollback(prefix: string): Promise<boolean> {
  const dir = temp(prefix);
  const { state, safety } = makeSafety(dir, { snapshot: () => true, restore: () => true });
  state.setInstalled('acme', {
    version: '2.0.0', fingerprint: 'sha256:new', files: {}, installedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    pendingHealthCheck: { version: '2.0.0', fingerprint: 'sha256:new', startedAt: new Date().toISOString() },
  });
  const result = await safety.reconcilePendingHealthChecks();
  const ok = result.rolledBack.includes('acme')
    && state.getInstalled('acme')?.degraded?.reason?.includes('health') === true;
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

async function scenarioUnsupportedApi(): Promise<boolean> {
  const dir = temp('api');
  writePackage(dir, 'future', 'module.exports = { name: "future" };', { apiVersion: 3 });
  const host = new PluginHost(dir, () => ({} as any), { hostVersion: '5.1.0' });
  await host.reload();
  const ok = host.getState().find((entry) => entry.name === 'future')?.error?.includes('unsupported apiVersion') === true;
  host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

describe('Phase 6 trust drill', () => {
  it('writes the drill report', async () => {
    const scenarios: Array<[string, () => Promise<boolean> | boolean]> = [
      ['update-rollback-before-commit', () => scenarioLastGood('before')],
      ['update-rollback-in-window', () => scenarioHealthRollback('window')],
      ['boot-loop-rollback', () => scenarioHealthRollback('boot')],
      ['integrity-mismatch', () => {
        const dir = temp('integrity');
        writePackage(dir, 'acme', 'x');
        const ok = verifyDeclaredIntegrity(dir, {
          algorithm: 'sha256', files: { 'index.js': 'sha256-deadbeef' },
        }).ok === false;
        fs.rmSync(dir, { recursive: true, force: true });
        return ok;
      }],
      ['safe-mode-persist', () => {
        const dir = temp('safe');
        const { state } = makeSafety(dir);
        state.setSafeMode(true);
        const ok = new PackageStateStore(dir).isSafeMode();
        fs.rmSync(dir, { recursive: true, force: true });
        return ok;
      }],
      ['auto-quarantine', () => {
        const dir = temp('quarantine');
        const { state, safety } = makeSafety(dir);
        safety.recordActivationFailure('acme', '1.0.0', 'boom');
        safety.recordActivationFailure('acme', '1.0.0', 'boom');
        safety.recordActivationFailure('acme', '1.0.0', 'boom');
        const ok = state.getQuarantine('acme') !== undefined;
        fs.rmSync(dir, { recursive: true, force: true });
        return ok;
      }],
      ['corrupt-state', () => {
        const dir = temp('corrupt');
        fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), '{ not json');
        const ok = new PackageStateStore(dir).isSafeMode();
        fs.rmSync(dir, { recursive: true, force: true });
        return ok;
      }],
      ['unsupported-api', scenarioUnsupportedApi],
      ['worker-crash-loop', () => {
        const dir = temp('worker');
        const { state, safety } = makeSafety(dir);
        for (let i = 0; i < 3; i += 1) {
          safety.recordActivationFailure('worker-pkg', '1.0.0', 'worker crashed 3 times in 5 minutes');
        }
        const ok = state.getQuarantine('worker-pkg')?.reason.includes('worker crashed') === true;
        fs.rmSync(dir, { recursive: true, force: true });
        return ok;
      }],
      ['version-skew', () => !isHostRangeCompatible('>=7.0.0', '5.1.0')],
    ];

    const report: any = { startedAt: new Date().toISOString(), node: process.version, scenarios: [] };
    for (const [id, run] of scenarios) {
      const started = Date.now();
      let ok = false;
      try { ok = await run(); } catch { ok = false; }
      report.scenarios.push({ id, ok, durationMs: Date.now() - started });
    }
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/plugin-trust-drill.json', JSON.stringify(report, null, 2));
    expect(report.scenarios).toHaveLength(10);
    expect(report.scenarios.every((entry: any) => entry.ok)).toBe(true);
  });
});
