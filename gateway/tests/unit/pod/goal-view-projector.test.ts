import type { DomainEvent } from '../../../src/core/events/domain-event';
import { projectGoalLifecycle } from '../../../src/core/pod/goal-view-projector';

const evt = (type: string, version: number, payload: Record<string, unknown> = {}): DomainEvent => ({
  eventId: `e${version}`, type, aggregateType: 'goal', aggregateId: 'g1',
  aggregateVersion: version, occurredAt: '2026-11-16T00:00:00.000Z',
  recordedAt: '2026-11-16T00:00:00.000Z', actor: null, correlationId: null,
  causationId: null, audience: 'none', schemaVersion: 1, payload,
});

test('replays a PASS lifecycle', () => {
  const p = projectGoalLifecycle([
    evt('goal.created', 1, { revision: 1 }),
    evt('goal.phase.changed', 2, { phase: 'EXECUTING', round: 1 }),
    evt('goal.result', 3, { verdict: 'PASS' }),
    evt('goal.accepted', 4, { revision: 1 }),
  ]);
  expect(p).toMatchObject({
    status: 'done', verdict: 'PASS', phase: 'EXECUTING', resultReady: true, accepted: true,
  });
});

test('replays a FAIL lifecycle and exposes the error', () => {
  const p = projectGoalLifecycle([
    evt('goal.created', 1, { revision: 1 }),
    evt('goal.node.failed', 2, { node: 'execute', message: 'boom' }),
    evt('goal.failed', 3, { verdict: 'MAX_RETRIES' }),
  ]);
  expect(p).toMatchObject({ status: 'done', failed: true, resultReady: false, lastError: 'boom' });
});

test('unknowable goals project to null', () => {
  expect(projectGoalLifecycle([])).toBeNull();
});

test('CANCELLED archives as aborted', () => {
  const p = projectGoalLifecycle([
    evt('goal.created', 1, { revision: 1 }),
    evt('goal.failed', 2, { verdict: 'CANCELLED' }),
  ]);
  expect(p).toMatchObject({ status: 'aborted', verdict: 'CANCELLED', failed: true });
});

test('out-of-order input still replays by aggregate version', () => {
  const p = projectGoalLifecycle([
    evt('goal.failed', 3, { verdict: 'FAIL' }),
    evt('goal.created', 1, { revision: 2 }),
    evt('goal.phase.changed', 2, { phase: 'REVIEW', round: 2 }),
  ]);
  expect(p).toMatchObject({ revision: 2, phase: 'REVIEW', round: 2, verdict: 'FAIL' });
});

test('revision advances from node and phase payloads when creation is missing', () => {
  const p = projectGoalLifecycle([
    evt('goal.phase.changed', 1, { phase: 'EXECUTING', round: 1, revision: 2 }),
    evt('goal.failed', 2, { verdict: 'FAIL', revision: 2 }),
  ]);
  expect(p).toMatchObject({ revision: 2, verdict: 'FAIL' });
});
