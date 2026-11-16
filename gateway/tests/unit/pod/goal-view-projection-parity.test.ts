import type { DomainEvent } from '../../../src/core/events/domain-event';
import { buildPodGoalView, type PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalRow } from '../../../src/core/pod/pod-store';
import { deriveAttention } from '../../../src/core/lead/attention';
import { projectGoalLifecycle } from '../../../src/core/pod/goal-view-projector';

const NOW = '2026-11-16T00:00:00.000Z';

const row = (over: Partial<PodGoalRow> = {}): PodGoalRow => ({
  id: 'row-g1',
  podId: 'pod_1',
  goalId: 'g1',
  status: 'done',
  verdict: null,
  activeRevision: 1,
  enqueuedAt: NOW,
  startedAt: NOW,
  endedAt: NOW,
  ...over,
});

const desc = (over: Partial<PodGoalDescription> = {}): PodGoalDescription => ({
  title: 'Goal',
  phase: 'REVIEW',
  nextAction: 'COMPLETED',
  terminal: true,
  verdict: null,
  hasResultEvidence: false,
  planApproval: null,
  pendingQuestion: null,
  nodeSession: null,
  lastError: null,
  ...over,
});

const evt = (type: string, version: number, payload: Record<string, unknown> = {}): DomainEvent => ({
  eventId: `e${version}`, type, aggregateType: 'goal', aggregateId: 'g1',
  aggregateVersion: version, occurredAt: NOW, recordedAt: NOW,
  actor: null, correlationId: null, causationId: null,
  audience: 'human', schemaVersion: 1, payload,
});

function compare(fixture: { row: PodGoalRow; description: PodGoalDescription; events: DomainEvent[] }) {
  const view = buildPodGoalView(fixture.row, fixture.description, undefined);
  const attention = deriveAttention([view]);
  const projection = projectGoalLifecycle(fixture.events)!;
  expect(projection.status).toBe(view.status);
  expect(projection.verdict).toBe(view.verdict);
  expect(projection.phase).toBe(view.phase);
  expect(projection.failed).toBe(attention.some((item) => item.kind === 'failed'));
  expect(projection.resultReady).toBe(view.resultReady);
  expect(projection.accepted).toBe(view.accepted);
}

test('PASS parity', () => {
  compare({
    row: row({ verdict: 'PASS' }),
    description: desc({ verdict: 'PASS', hasResultEvidence: true }),
    events: [
      evt('goal.created', 1, { revision: 1 }),
      evt('goal.phase.changed', 2, { phase: 'REVIEW', round: 1 }),
      evt('goal.result', 3, { verdict: 'PASS' }),
    ],
  });
});

test('FAIL parity', () => {
  compare({
    row: row({ verdict: 'FAIL' }),
    description: desc({ verdict: 'FAIL', lastError: 'tests red' }),
    events: [
      evt('goal.created', 1, { revision: 1 }),
      evt('goal.phase.changed', 2, { phase: 'REVIEW', round: 1 }),
      evt('goal.failed', 3, { verdict: 'FAIL', lastError: 'tests red' }),
    ],  });
});

test('MAX_RETRIES parity', () => {
  compare({
    row: row({ verdict: 'MAX_RETRIES' }),
    description: desc({ verdict: 'MAX_RETRIES', nextAction: 'FAILED', lastError: 'rounds exhausted' }),
    events: [
      evt('goal.created', 1, { revision: 1 }),
      evt('goal.phase.changed', 2, { phase: 'REVIEW', round: 1 }),
      evt('goal.failed', 3, { verdict: 'MAX_RETRIES', lastError: 'rounds exhausted' }),
    ],
  });
});

test('ERROR parity', () => {
  compare({
    row: row({ verdict: 'ERROR' }),
    description: desc({ verdict: 'ERROR', lastError: 'worktree failed' }),
    events: [
      evt('goal.created', 1, { revision: 1 }),
      evt('goal.phase.changed', 2, { phase: 'REVIEW', round: 1 }),
      evt('goal.failed', 3, { verdict: 'ERROR', lastError: 'worktree failed' }),
    ],
  });
});
