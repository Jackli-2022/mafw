import Database from 'better-sqlite3';
import { EventStore } from '../../src/core/events/event-store';
import { EventLayerService } from '../../src/core/events/event-layer-service';
import { normalizeGitHubEvent, normalizeInternalEvent } from '../../src/core/events/event-normalize';

function integrationHarness() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  store.insertSource({
    id: 's1',
    projectDir: '/p',
    kind: 'github',
    name: 'acme/app',
    config: { repo: 'acme/app' },
    now: '2026-11-10T00:00:00.000Z',
  });
  const deliverWork = jest.fn(async () => {});
  const deliverContext = jest.fn(async () => {});
  let seq = 0;
  const service = new EventLayerService({
    store,
    now: () => '2026-11-10T00:00:02.000Z',
    newId: (prefix) => (prefix === 'thread' ? 't1' : `${prefix}_${++seq}`),
    broadcast: jest.fn(),
    enabled: () => true,
    evaluate: async () => ({ decision: 'accept', mode: 'full', rationale: 'new PR' }),
    deliverWork,
    deliverContext,
  });
  return { store, service, deliverWork, deliverContext };
}

const base = {
  projectDir: '/p',
  sourceId: 's1',
  deliveryId: 'd1',
  event: 'pull_request',
  repo: 'acme/app',
  number: 42,
  actor: 'alice',
  payload: { title: 'Fix' },
  occurredAt: '2026-11-10T00:00:00.000Z',
  receivedAt: '2026-11-10T00:00:01.000Z',
};

test('PR opened -> one thread -> work delivery -> Tech Lead accept -> delivery audit', async () => {
  const h = integrationHarness();
  h.service.ingest(normalizeGitHubEvent({ ...base, action: 'opened' }));
  h.service.subscribe({
    threadId: 't1',
    subscriberType: 'standing_goal',
    subscriberId: 'sg1',
    mode: 'work',
  });
  h.service.fanOut('t1');
  await h.service.evaluate('t1');

  expect(h.service.listThreads('/p')).toHaveLength(1);
  expect(h.service.listDeliveries('t1')[0]).toMatchObject({ state: 'delivered' });
  expect(h.deliverWork).toHaveBeenCalledTimes(1);
  expect(h.store.latestDecision('t1')).toMatchObject({ decision: 'accept' });
});

test('decision draft -> lead context delivery without work execution', async () => {
  const h = integrationHarness();
  h.service.ensureSystemSource('internal');
  const ingested = h.service.ingest(normalizeInternalEvent({
    projectDir: '/p',
    sourceId: 'internal',
    eventId: 'decision.drafted:rec1',
    kind: 'decision.drafted',
    aggregateId: 'rec1',
    actor: 'agent',
    payload: {
      recordId: 'rec1',
      question: 'A or B?',
      options: [{ id: 'a', title: 'A' }],
    },
    occurredAt: '2026-11-10T00:00:00.000Z',
    receivedAt: '2026-11-10T00:00:01.000Z',
  }));
  h.service.subscribe({
    threadId: ingested.thread.id,
    subscriberType: 'lead',
    subscriberId: 'pod_1',
    mode: 'context',
  });
  h.service.fanOut(ingested.thread.id);
  await h.service.evaluate(ingested.thread.id);

  expect(h.service.listThreads('/p')).toHaveLength(1);
  expect(h.deliverContext).toHaveBeenCalledTimes(1);
  expect(h.deliverContext.mock.calls[0][0].trigger.kind).toBe('decision.drafted');
  expect(h.deliverWork).not.toHaveBeenCalled();
  expect(h.service.listDeliveries(ingested.thread.id)[0]).toMatchObject({ state: 'delivered' });
  expect(h.store.latestDecision(ingested.thread.id)).toMatchObject({ decision: 'accept' });
});
