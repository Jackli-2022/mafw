import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageStateStore } from '../../../src/plugins/package-state-store';
import { PluginSafety } from '../../../src/plugins/plugin-safety';

function makeSafety(restore = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-health-'));
  const state = new PackageStateStore(dir);
  const lastGood = {
    snapshot: jest.fn(() => true),
    restore: jest.fn(() => restore),
  };
  const safety = new PluginSafety({
    state,
    host: { deactivate: async () => true, deactivateAll: async () => [] },
    audit: { append: () => true },
    lastGood,
    autoConfirm: false,
  });
  return { safety, state, lastGood, dir };
}

function installed(fingerprint: string, extras: Record<string, unknown> = {}) {
  return {
    version: '2.0.0',
    fingerprint,
    files: {},
    installedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    ...extras,
  };
}

describe('PluginSafety health window', () => {
  it('promotes a confirmed version to last-known-good', () => {
    const { safety, state, lastGood, dir } = makeSafety();
    state.setInstalled('acme', installed('sha256:new'));
    safety.beginHealthCheck('acme', { version: '2.0.0', fingerprint: 'sha256:new' });
    expect(state.getInstalled('acme')?.pendingHealthCheck).toBeDefined();

    safety.confirmHealthCheck('acme');

    expect(lastGood.snapshot).toHaveBeenCalledWith('acme', {
      version: '2.0.0', fingerprint: 'sha256:new',
    });
    expect(state.getInstalled('acme')?.lastKnownGood).toMatchObject({ fingerprint: 'sha256:new' });
    expect(state.getInstalled('acme')?.pendingHealthCheck).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restores last-known-good for an unconfirmed health check', async () => {
    const { safety, state, lastGood, dir } = makeSafety();
    state.setInstalled('acme', installed('sha256:new', {
      pendingHealthCheck: {
        version: '2.0.0', fingerprint: 'sha256:new', startedAt: new Date().toISOString(),
      },
    }));

    await expect(safety.reconcilePendingHealthChecks()).resolves.toEqual({
      rolledBack: ['acme'], quarantined: [],
    });
    expect(lastGood.restore).toHaveBeenCalledWith('acme');
    expect(state.getInstalled('acme')?.degraded?.reason).toContain('health');
    expect(state.getInstalled('acme')?.pendingHealthCheck).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quarantines when no last-known-good can be restored', async () => {
    const { safety, state, dir } = makeSafety(false);
    state.setInstalled('acme', installed('sha256:new', {
      pendingHealthCheck: {
        version: '2.0.0', fingerprint: 'sha256:new', startedAt: new Date().toISOString(),
      },
    }));
    await expect(safety.reconcilePendingHealthChecks()).resolves.toEqual({
      rolledBack: [], quarantined: ['acme'],
    });
    expect(safety.blockedReason('acme')).toBe('quarantined');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
