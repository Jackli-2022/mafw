import {
  goalCreatedEvent,
  goalNodeFailedEvent,
  goalNodeFinishedEvent,
  goalNodeStartedEvent,
  goalPhaseChangedEvent,
} from '../../../src/core/goal/goal-lifecycle-events';

test('maps a node start to a goal aggregate event', () => {
  const e = goalNodeFailedEvent({
    goalId: 'g1', node: 'execute', round: 2, attempt: 1, revision: 1,
    projectDir: '/p', failureClass: 'test', code: 'red', message: 'boom',
    occurredAt: '2026-11-16T00:00:00.000Z',
  });
  expect(e).toMatchObject({
    type: 'goal.node.failed',
    aggregateType: 'goal',
    aggregateId: 'g1',
    audience: 'human',
    payload: { node: 'execute', round: 2, attempt: 1, failureClass: 'test', code: 'red' },
  });
});

test('phase and created events stay internal', () => {
  expect(goalPhaseChangedEvent({
    goalId: 'g1', phase: 'EXECUTING', round: 1, projectDir: '/p',
    occurredAt: '2026-11-16T00:00:00.000Z',
  }).audience).toBe('none');
  expect(goalCreatedEvent({
    goalId: 'g1', revision: 1, maxRounds: 3, occurredAt: '2026-11-16T00:00:00.000Z',
  }).type).toBe('goal.created');
});

test('node finished carries the outcome', () => {
  expect(goalNodeFinishedEvent({
    goalId: 'g1', node: 'plan', round: 1, attempt: 1, revision: 1,
    projectDir: '/p', outcome: 'success', occurredAt: '2026-11-16T00:00:00.000Z',
  }).payload).toMatchObject({ outcome: 'success' });
});

test('node started carries node, round and attempt', () => {
  expect(goalNodeStartedEvent({
    goalId: 'g1', node: 'execute', round: 2, attempt: 3, revision: 1,
    projectDir: '/p', occurredAt: '2026-11-16T00:00:00.000Z',
  })).toMatchObject({
    type: 'goal.node.started',
    audience: 'none',
    payload: { node: 'execute', round: 2, attempt: 3, projectDir: '/p' },
  });
});
