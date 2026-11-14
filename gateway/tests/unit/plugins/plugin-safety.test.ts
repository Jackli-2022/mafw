import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageStateStore } from '../../../src/plugins/package-state-store';
import { PluginSafety } from '../../../src/plugins/plugin-safety';

function makeSafety(options: { oneRunSafeMode?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-safety-'));
  const state = new PackageStateStore(dir);
  const audit = { append: jest.fn(() => true) };
  const host = {
    deactivate: jest.fn(async () => true),
    deactivateAll: jest.fn(async () => ['acme', 'beta']),
  };
  const safety = new PluginSafety({
    state,
    host,
    audit,
    oneRunSafeMode: options.oneRunSafeMode,
  });
  return { safety, state, audit, host, dir };
}

afterEach(() => {
  fs.rmSync(path.join(os.tmpdir(), 'mafw-safety-'), { recursive: true, force: true });
});

describe('PluginSafety', () => {
  it('blocks packages in safe mode, quarantine and disabled order', () => {
    const { safety, state } = makeSafety();
    expect(safety.blockedReason('acme')).toBeNull();
    state.setDisabled('acme', true);
    expect(safety.blockedReason('acme')).toBe('disabled');
    state.setDisabled('acme', false);
    safety.quarantine('acme', 'manual');
    expect(safety.blockedReason('acme')).toBe('quarantined');
    state.setSafeMode(true);
    expect(safety.blockedReason('acme')).toBe('safe-mode');
  });

  it('quarantines after three consecutive activation failures', () => {
    const { safety, state } = makeSafety();
    safety.recordActivationFailure('acme', '1.0.0', 'boom');
    safety.recordActivationFailure('acme', '1.0.0', 'boom');
    expect(safety.recordActivationFailure('acme', '1.0.0', 'boom')).toEqual({ quarantined: true });
    expect(state.getQuarantine('acme')?.reason).toContain('3 consecutive');
  });

  it('resets the failure counter on success', () => {
    const { safety, state } = makeSafety();
    safety.recordActivationFailure('acme', '1.0.0', 'boom');
    safety.recordActivationSuccess('acme');
    expect(state.getInstalled('acme')?.consecutiveFailures).toBe(0);
  });

  it('honors a one-run safe mode without persisting it', () => {
    const { safety, state } = makeSafety({ oneRunSafeMode: true });
    expect(safety.blockedReason('acme')).toBe('safe-mode');
    expect(state.isSafeMode()).toBe(false);
  });

  it('kill deactivates all packages and persists safe mode', async () => {
    const { safety, state, host } = makeSafety();
    await expect(safety.kill({ principalKind: 'service' })).resolves.toEqual({
      safeMode: true, stopped: ['acme', 'beta'],
    });
    expect(state.isSafeMode()).toBe(true);
    expect(host.deactivateAll).toHaveBeenCalled();
  });

  it('resume clears safe mode but does not enable disabled or quarantined packages', async () => {
    const { safety, state } = makeSafety();
    state.setSafeMode(true);
    state.setDisabled('beta', true);
    state.setQuarantine({ name: 'acme', reason: 'x', at: '2026-11-14T00:00:00.000Z' });
    await expect(safety.resume({ principalKind: 'human' })).resolves.toEqual({
      safeMode: false, activated: [],
    });
    expect(state.isSafeMode()).toBe(false);
    expect(state.isDisabled('beta')).toBe(true);
    expect(state.getQuarantine('acme')).toBeDefined();
  });

  it('writes audit events for quarantine and kill', async () => {
    const { safety, audit } = makeSafety();
    safety.quarantine('acme', 'integrity');
    await safety.kill({ principalKind: 'service', principalMethod: 'api-token' });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'quarantine', package: 'acme',
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'safe-mode.on', principalKind: 'service',
    }));
  });
});
