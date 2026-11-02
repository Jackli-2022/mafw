import {
  readManagerSlot,
  writeManagerSlot,
  resolveManagerRuntime,
} from '../../src/core/manager/manager-session-runtime';

const OC = { sessionId: 'ses_f60d', createdAt: '2026-09-14T09:07:10.054Z' };
const PI = { sessionId: 'pi_9f2c', createdAt: '2026-09-16T03:00:00.000Z' };

describe('manager-session per-runtime slots', () => {
  it('resolveManagerRuntime: explicit tag only — session id prefixes are not ownership evidence', () => {
    expect(resolveManagerRuntime({ sessionId: 'ses_x', runtime: 'pi' })).toBe('pi');
    // opencode / pi 的 id 前缀是 runtime 私有命名约定，不得用于归属推断。
    expect(resolveManagerRuntime({ id: 'ses_abc' })).toBeNull();
    expect(resolveManagerRuntime({ id: 'pi_0023' })).toBeNull();
    expect(resolveManagerRuntime({ sessionId: 'weird_1' })).toBeNull();
    expect(resolveManagerRuntime({ runtime: '   ' })).toBeNull();
    expect(resolveManagerRuntime({})).toBeNull();
  });

  it('readManagerSlot: v2 returns the active runtime slot', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    expect(readManagerSlot(v2, 'opencode')).toEqual(OC);
    expect(readManagerSlot(v2, 'pi')).toEqual(PI);
    expect(readManagerSlot(v2, 'gemini')).toBeNull();
  });

  it('readManagerSlot: untagged v1 legacy stays dormant (no guessing)', () => {
    expect(readManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'opencode')).toBeNull();
    expect(readManagerSlot({ sessionId: 'pi_9f2c' }, 'pi')).toBeNull();
  });

  it('readManagerSlot: tagged v1 legacy resolves to its explicit runtime only', () => {
    expect(readManagerSlot({ sessionId: 'pi_9f2c', runtime: 'pi' }, 'pi')).toEqual({ sessionId: 'pi_9f2c' });
    expect(readManagerSlot({ sessionId: 'pi_9f2c', runtime: 'pi' }, 'opencode')).toBeNull();
  });

  it('readManagerSlot: empty/malformed values yield null', () => {
    expect(readManagerSlot(null, 'pi')).toBeNull();
    expect(readManagerSlot({}, 'pi')).toBeNull();
    expect(readManagerSlot({ byRuntime: {} }, 'pi')).toBeNull();
  });

  it('writeManagerSlot: tagged v1 legacy migrates into its own slot, current slot set', () => {
    const out = writeManagerSlot({ sessionId: 'ses_f60d', runtime: 'opencode', createdAt: OC.createdAt }, 'pi', PI);
    expect(out.byRuntime.opencode).toEqual(OC);
    expect(out.byRuntime.pi).toEqual(PI);
    expect(out.unattributed).toBeUndefined();
  });

  it('writeManagerSlot: untagged v1 legacy is preserved as unattributed (never guessed, never dropped)', () => {
    const out = writeManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'pi', PI);
    expect(out.byRuntime).toEqual({ pi: PI });
    expect(out.unattributed).toEqual(OC);
  });

  it('writeManagerSlot: v2 keeps other slots and replaces only the current one (rotate)', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    const rotated = { sessionId: 'pi_aaaa', createdAt: '2026-09-16T04:00:00.000Z' };
    const out = writeManagerSlot(v2, 'pi', rotated);
    expect(out.byRuntime.opencode).toEqual(OC); // untouched
    expect(out.byRuntime.pi).toEqual(rotated);  // replaced
  });

  it('writeManagerSlot: v2 keeps the unattributed legacy entry across writes', () => {
    const v2 = { byRuntime: { opencode: OC }, unattributed: PI };
    const rotated = { sessionId: 'ses_new', createdAt: '2026-09-17T00:00:00.000Z' };
    const out = writeManagerSlot(v2, 'opencode', rotated);
    expect(out.byRuntime.opencode).toEqual(rotated);
    expect(out.unattributed).toEqual(PI);
  });

  it('writeManagerSlot: fresh entry (no existing value) creates a single slot', () => {
    const out = writeManagerSlot(null, 'opencode', OC);
    expect(out.byRuntime).toEqual({ opencode: OC });
  });
});
