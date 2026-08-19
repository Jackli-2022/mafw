import {
  shouldConsiderStep,
  stepPropsFromPartUpdated,
  stepPropsFromMessageUpdated,
  selectMemories,
  memoryFingerprint,
  StepInjectState,
  defaultStepInjectOptions,
} from '../../../gateway/src/recall/step-inject';

describe('shouldConsiderStep', () => {
  test('rejects tool-calls finish (still in tool loop)', () => {
    expect(shouldConsiderStep({ sessionID: 's', assistantMessageID: 'm1', finish: 'tool-calls' })).toBe(false);
  });

  test('rejects unknown finish', () => {
    expect(shouldConsiderStep({ sessionID: 's', assistantMessageID: 'm1', finish: 'unknown' })).toBe(false);
  });

  test('accepts settled finishes', () => {
    for (const finish of ['stop', 'end_turn', 'max_tokens', undefined]) {
      expect(shouldConsiderStep({ sessionID: 's', assistantMessageID: 'm1', finish })).toBe(true);
    }
  });

  test('rejects missing sessionID or assistantMessageID', () => {
    expect(shouldConsiderStep({ sessionID: '', assistantMessageID: 'm1', finish: 'stop' })).toBe(false);
    expect(shouldConsiderStep({ sessionID: 's', assistantMessageID: '', finish: 'stop' })).toBe(false);
  });
});

describe('selectMemories', () => {
  const results = [
    { id: 'a', energy: 0.9 },
    { id: 'b', energy: 0.75 },
    { id: 'c', energy: 0.6 },
    { id: 'd', energy: 0.8 },
  ];

  test('keeps only energy >= threshold and caps the count', () => {
    const picked = selectMemories(results, 0.7, 2);
    expect(picked.map((m) => m.id)).toEqual(['a', 'd']);
  });

  test('returns none when nothing meets the threshold', () => {
    expect(selectMemories(results, 0.95, 2)).toEqual([]);
  });
});

describe('memoryFingerprint', () => {
  test('is order-independent (sorted IDs)', () => {
    expect(memoryFingerprint(['b', 'a'])).toBe(memoryFingerprint(['a', 'b']));
  });

  test('distinguishes different groups', () => {
    expect(memoryFingerprint(['a'])).not.toBe(memoryFingerprint(['a', 'b']));
  });
});

describe('stepPropsFromPartUpdated', () => {
  test('returns null for non-step-finish parts', () => {
    expect(stepPropsFromPartUpdated({ part: { type: 'text', text: 'hi' } })).toBeNull();
    expect(stepPropsFromPartUpdated({ part: { type: 'step-start', messageID: 'm1', sessionID: 's1' } })).toBeNull();
    expect(stepPropsFromPartUpdated({})).toBeNull();
  });

  test('maps step-finish part to StepEndedProps', () => {
    expect(stepPropsFromPartUpdated({
      part: {
        type: 'step-finish',
        sessionID: 's1',
        messageID: 'm1',
        reason: 'stop',
      },
    })).toEqual({
      sessionID: 's1',
      assistantMessageID: 'm1',
      finish: 'stop',
    });
  });

  test('propagates undefined fields', () => {
    expect(stepPropsFromPartUpdated({
      part: {
        type: 'step-finish',
        sessionID: 's1',
        messageID: 'm1',
      },
    })).toEqual({
      sessionID: 's1',
      assistantMessageID: 'm1',
      finish: undefined,
    });
  });
});

describe('stepPropsFromMessageUpdated', () => {
  test('returns null for non-assistant or incomplete messages', () => {
    expect(stepPropsFromMessageUpdated({
      info: { role: 'user', id: 'm1', sessionID: 's1', time: { completed: '2026-08-18T00:00:00Z' } },
    })).toBeNull();
    expect(stepPropsFromMessageUpdated({
      info: { role: 'assistant', id: 'm1', sessionID: 's1' },
    })).toBeNull();
    expect(stepPropsFromMessageUpdated({})).toBeNull();
  });

  test('maps completed assistant message to StepEndedProps', () => {
    expect(stepPropsFromMessageUpdated({
      info: {
        role: 'assistant',
        id: 'm1',
        sessionID: 's1',
        finish: 'stop',
        time: { completed: '2026-08-18T00:00:00Z' },
      },
    })).toEqual({
      sessionID: 's1',
      assistantMessageID: 'm1',
      finish: 'stop',
    });
  });
});

describe('StepInjectState mark-before-async', () => {
  const opts = defaultStepInjectOptions();

  test('first evaluation returns true, duplicates return false', () => {
    const state = new StepInjectState(opts);
    expect(state.markStepSeen('s1', 'm1')).toBe(true);
    expect(state.markStepSeen('s1', 'm1')).toBe(false);
    // different assistant message 鈫?new evaluation
    expect(state.markStepSeen('s1', 'm2')).toBe(true);
    // different session isolated
    expect(state.markStepSeen('s2', 'm1')).toBe(true);
  });

  test('fingerprint dedup prevents A/B/A re-injection', () => {
    const state = new StepInjectState(opts);
    state.enqueue('s1', { block: 'x', memIds: ['a'], at: 0 });
    state.markInjected('s1', ['a'], memoryFingerprint(['a']));

    state.enqueue('s1', { block: 'y', memIds: ['a', 'b'], at: 0 });
    expect(state.fingerprintSeen('s1', memoryFingerprint(['a']))).toBe(true);
    expect(state.fingerprintSeen('s1', memoryFingerprint(['a', 'b']))).toBe(false);
  });
});
