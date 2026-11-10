import test from 'node:test';
import assert from 'node:assert/strict';
import { MAFW, MAFW_RUNTIME_EVENT_NAMES, RUNTIME_IDENTITY_TYPES } from './index.ts';

/**
 * Plan 6 Task 3: the canonical MAFW vocabulary moved out of the gateway into
 * `@mafw/runtime-contract`. These pins are the contract-side guard: the
 * gateway shim (`gateway/src/runtime/mafw-vocabulary.ts`) re-exports this
 * module, so any key/value drift here is a vocabulary drift for both sides.
 */
test('MAFW pins the canonical event vocabulary keys and values', () => {
  assert.deepEqual(Object.keys(MAFW), [
    'sessionCreated',
    'sessionUpdated',
    'sessionDeleted',
    'turnStarted',
    'turnCompleted',
    'turnFailed',
    'turnAborted',
    'sessionCompacting',
    'sessionCompacted',
    'messageUpdated',
    'partUpdated',
    'partDelta',
    'partComplete',
    'questionAsked',
    'questionReplied',
    'questionRejected',
    'permissionAsked',
    'permissionReplied',
    'planUpdated',
    'usageUpdated',
    'queueUpdated',
    'taskUpdated',
    'backgroundJobUpdated',
    'podUpdated',
    'podEvent',
    'sessionConfig',
    'sessionCheckpoint',
    'runUpdated',
    'trajectoryEvent',
    'trajectoryTurn',
    'permissionMode',
    'sessionDiff',
    'sessionCommands',
    'envelope',
  ]);

  assert.equal(MAFW.sessionCreated, 'session.created');
  assert.equal(MAFW.turnCompleted, 'turn.completed');
  assert.equal(MAFW.partComplete, 'part.complete');
  assert.equal(MAFW.planUpdated, 'plan.updated');
  assert.equal(MAFW.queueUpdated, 'queue.updated');
  assert.equal(MAFW.backgroundJobUpdated, 'background.job.updated');
  assert.equal(MAFW.sessionDiff, 'session.diff');
  assert.equal(MAFW.envelope, 'mafw_event');

  const values = Object.values(MAFW);
  assert.equal(new Set(values).size, values.length, 'MAFW values must stay unique');
});

test('MAFW_RUNTIME_EVENT_NAMES is every event minus the wire envelope', () => {
  assert.deepEqual(
    [...MAFW_RUNTIME_EVENT_NAMES],
    Object.values(MAFW).filter((value) => value !== MAFW.envelope),
  );
  assert.ok(!MAFW_RUNTIME_EVENT_NAMES.includes('mafw_event'));
  for (const type of [
    'session.created',
    'turn.completed',
    'part.complete',
    'usage.updated',
    'queue.updated',
    'background.job.updated',
    'pod.updated',
    'session.diff',
  ]) {
    assert.ok(MAFW_RUNTIME_EVENT_NAMES.includes(type), type);
  }
});

test('RUNTIME_IDENTITY_TYPES is the runtime vocabulary plus the tool primitives', () => {
  assert.deepEqual(
    [...RUNTIME_IDENTITY_TYPES],
    [...MAFW_RUNTIME_EVENT_NAMES, 'tool.call', 'tool.delta', 'tool.result'],
  );
  assert.equal(
    new Set(RUNTIME_IDENTITY_TYPES).size,
    RUNTIME_IDENTITY_TYPES.length,
    'RUNTIME_IDENTITY_TYPES must not contain duplicates',
  );
});
