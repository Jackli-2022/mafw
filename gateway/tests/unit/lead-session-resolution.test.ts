import { resolveLeadCandidate, shouldEnsureLeadOnStartup } from '../../src/core/manager/lead-session-resolution';

describe('resolveLeadCandidate', () => {
  test('live slot wins over live pod', () => {
    expect(resolveLeadCandidate({
      slot: { sessionId: 'ses_slot', source: 'slot' },
      pod: { sessionId: 'ses_pod', source: 'pod' },
    })).toEqual({ action: 'reuse', sessionId: 'ses_slot', source: 'slot' });
  });

  test('missing slot adopts live pod instead of creating', () => {
    expect(resolveLeadCandidate({
      slot: null,
      pod: { sessionId: 'ses_pod', source: 'pod' },
    })).toEqual({ action: 'reuse', sessionId: 'ses_pod', source: 'pod' });
  });

  test('ambiguous slot keys without live pod refuses to create a second Lead', () => {
    expect(resolveLeadCandidate({ slot: null, pod: null, slotKeyConflict: true }))
      .toEqual({ action: 'conflict', reason: 'ambiguous_slot_keys' });
  });

  test('both absent creates exactly one replacement', () => {
    expect(resolveLeadCandidate({ slot: null, pod: null })).toEqual({ action: 'create' });
  });

  test('startup only ensures Pod projects or in-flight goals', () => {
    expect(shouldEnsureLeadOnStartup({ hasPod: true, hasInFlightGoal: false })).toBe(true);
    expect(shouldEnsureLeadOnStartup({ hasPod: false, hasInFlightGoal: true })).toBe(true);
    expect(shouldEnsureLeadOnStartup({ hasPod: false, hasInFlightGoal: false })).toBe(false);
  });
});
