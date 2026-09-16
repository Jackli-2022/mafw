import { readManagerSlot, writeManagerSlot, managerEntryRuntime } from '../../src/core/manager/manager-session-runtime';

const OC = { sessionId: 'ses_f60d', createdAt: '2026-09-14T09:07:10.054Z' };
const PI = { sessionId: 'pi_9f2c', createdAt: '2026-09-16T03:00:00.000Z' };

describe('manager-session per-runtime slots', () => {
  it('managerEntryRuntime: explicit tag wins, then prefix inference, then null', () => {
    expect(managerEntryRuntime({ sessionId: 'ses_x', runtime: 'pi' })).toBe('pi');
    expect(managerEntryRuntime({ sessionId: 'ses_abc' })).toBe('opencode');
    expect(managerEntryRuntime({ sessionId: 'pi_0023' })).toBe('pi');
    expect(managerEntryRuntime({ sessionId: 'weird_1' })).toBeNull();
    expect(managerEntryRuntime({})).toBeNull();
  });

  it('readManagerSlot: v2 returns the active runtime slot', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    expect(readManagerSlot(v2, 'opencode')).toEqual(OC);
    expect(readManagerSlot(v2, 'pi')).toEqual(PI);
    expect(readManagerSlot(v2, 'gemini')).toBeNull();
  });

  it('readManagerSlot: v1 legacy migrates by prefix — matches only when runtime matches', () => {
    expect(readManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'opencode')).toEqual(OC);
    expect(readManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'pi')).toBeNull();
    expect(readManagerSlot({ sessionId: 'pi_9f2c' }, 'pi')).toEqual({ sessionId: 'pi_9f2c' });
  });

  it('readManagerSlot: empty/malformed values yield null', () => {
    expect(readManagerSlot(null, 'pi')).toBeNull();
    expect(readManagerSlot({}, 'pi')).toBeNull();
    expect(readManagerSlot({ byRuntime: {} }, 'pi')).toBeNull();
  });

  it('writeManagerSlot: v1 legacy migrates into its inferred slot, current slot set', () => {
    const out = writeManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'pi', PI);
    expect(out.byRuntime.opencode).toEqual(OC);
    expect(out.byRuntime.pi).toEqual(PI);
  });

  it('writeManagerSlot: v2 keeps other slots and replaces only the current one (rotate)', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    const rotated = { sessionId: 'pi_aaaa', createdAt: '2026-09-16T04:00:00.000Z' };
    const out = writeManagerSlot(v2, 'pi', rotated);
    expect(out.byRuntime.opencode).toEqual(OC); // untouched
    expect(out.byRuntime.pi).toEqual(rotated);  // replaced
  });

  it('writeManagerSlot: fresh entry (no existing value) creates a single slot', () => {
    const out = writeManagerSlot(null, 'opencode', OC);
    expect(out.byRuntime).toEqual({ opencode: OC });
  });

  it('writeManagerSlot: legacy entry with unrecognizable prefix is not carried over', () => {
    const out = writeManagerSlot({ sessionId: 'weird_1' }, 'opencode', OC);
    expect(out.byRuntime).toEqual({ opencode: OC });
  });
});
