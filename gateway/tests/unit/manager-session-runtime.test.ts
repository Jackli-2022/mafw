import { isManagerEntryStale, managerEntryRuntime } from '../../src/core/manager/manager-session-runtime';

describe('manager-session runtime ownership predicate', () => {
  it('explicit runtime tag wins over prefix inference', () => {
    expect(managerEntryRuntime({ sessionId: 'ses_x', runtime: 'pi' })).toBe('pi');
    expect(managerEntryRuntime({ sessionId: 'pi_y', runtime: 'opencode' })).toBe('opencode');
  });

  it('infers runtime from the session id prefix for legacy entries', () => {
    expect(managerEntryRuntime({ sessionId: 'ses_abc' })).toBe('opencode');
    expect(managerEntryRuntime({ sessionId: 'pi_0023' })).toBe('pi');
  });

  it('returns null when neither tag nor recognizable prefix exists', () => {
    expect(managerEntryRuntime({ sessionId: 'weird_1' })).toBeNull();
    expect(managerEntryRuntime({})).toBeNull();
  });

  it('stale: entry runtime differs from the active runtime', () => {
    expect(isManagerEntryStale({ sessionId: 'ses_abc' }, 'pi')).toBe(true);
    expect(isManagerEntryStale({ sessionId: 'ses_abc', runtime: 'opencode' }, 'pi')).toBe(true);
    expect(isManagerEntryStale({ sessionId: 'pi_1', runtime: 'pi' }, 'opencode')).toBe(true);
  });

  it('not stale: entry belongs to the active runtime', () => {
    expect(isManagerEntryStale({ sessionId: 'pi_1' }, 'pi')).toBe(false);
    expect(isManagerEntryStale({ sessionId: 'ses_abc' }, 'opencode')).toBe(false);
    expect(isManagerEntryStale({ sessionId: 'ses_abc', runtime: 'opencode' }, 'opencode')).toBe(false);
  });

  it('conservative: unknown origin or unknown current runtime is kept, malformed is stale', () => {
    expect(isManagerEntryStale({ sessionId: 'weird_1' }, 'pi')).toBe(false);
    expect(isManagerEntryStale({ sessionId: 'ses_abc' }, undefined)).toBe(false);
    expect(isManagerEntryStale(null, 'pi')).toBe(true);
    expect(isManagerEntryStale({}, 'pi')).toBe(true);
  });
});
