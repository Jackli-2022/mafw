import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnTracker } from './turn-tracker.ts';

type Raw = { type: string; sessionID?: string };

function makeTracker(sink: Raw[]) {
  return createTurnTracker<Raw>({
    push: (v) => sink.push(v),
    sessionIdOf: (raw) => raw.sessionID,
    isTurnStart: (raw) => raw.type === 'user',
    isTerminal: (raw) => raw.type === 'result',
    makeTurnStarted: (sessionID) => ({ type: 'turn.started', sessionID }),
  });
}

test('first turn-start emits synthetic turn.started before the raw event', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user', sessionID: 's1' });
  assert.deepEqual(sink.map((e) => e.type), ['turn.started', 'user']);
});

test('second turn-start in the same turn passes through without synthesis', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user', sessionID: 's1' });
  tracker.push({ type: 'user', sessionID: 's1' });
  assert.deepEqual(sink.map((e) => e.type), ['turn.started', 'user', 'user']);
});

test('terminal resets so the next turn starts are synthesized again', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user', sessionID: 's1' });
  tracker.push({ type: 'result', sessionID: 's1' });
  tracker.push({ type: 'user', sessionID: 's1' });
  assert.deepEqual(sink.map((e) => e.type), ['turn.started', 'user', 'result', 'turn.started', 'user']);
});

test('sessions are tracked independently', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user', sessionID: 's1' });
  tracker.push({ type: 'user', sessionID: 's2' });
  assert.deepEqual(sink, [
    { type: 'turn.started', sessionID: 's1' },
    { type: 'user', sessionID: 's1' },
    { type: 'turn.started', sessionID: 's2' },
    { type: 'user', sessionID: 's2' },
  ]);
});

test('raw events without a session id pass through untouched', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user' });
  tracker.push({ type: 'result' });
  assert.deepEqual(sink, [{ type: 'user' }, { type: 'result' }]);
});

test('reset clears in-flight state for local failures', () => {
  const sink: Raw[] = [];
  const tracker = makeTracker(sink);
  tracker.push({ type: 'user', sessionID: 's1' });
  tracker.reset('s1');
  tracker.push({ type: 'user', sessionID: 's1' });
  assert.deepEqual(sink.map((e) => e.type), ['turn.started', 'user', 'turn.started', 'user']);
});
