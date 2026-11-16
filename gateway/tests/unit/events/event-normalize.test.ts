import {
  normalizeCronTick,
  normalizeGitHubEvent,
  normalizeInternalEvent,
  normalizeWebhookEvent,
} from '../../../src/core/events/event-normalize';

describe('event normalize', () => {
  test('maps a PR opened delivery to one repo#number thread', () => {
    const out = normalizeGitHubEvent({
      projectDir: '/p',
      sourceId: 's1',
      deliveryId: 'd1',
      event: 'pull_request',
      action: 'opened',
      repo: 'acme/app',
      number: 42,
      actor: 'alice',
      payload: { title: 'Fix' },
      occurredAt: '2026-11-10T00:00:00.000Z',
      receivedAt: '2026-11-10T00:00:01.000Z',
    });

    expect(out).toMatchObject({
      kind: 'pr_opened',
      externalKey: 'acme/app#42',
      idempotencyKey: 'github:d1',
      sourceKind: 'github',
    });
  });

  test('cron ticks use a synthetic cron thread and stable key', () => {
    expect(normalizeCronTick({
      projectDir: '/p',
      sourceId: 's1',
      standingGoalId: 'sg1',
      scheduledAt: '2026-11-10T00:00:00.000Z',
      actualAt: '2026-11-10T00:00:02.000Z',
    })).toMatchObject({
      kind: 'cron_tick',
      externalKey: 'cron:sg1',
      idempotencyKey: 'cron:sg1:2026-11-10T00:00:00.000Z',
      sourceKind: 'cron',
    });
  });

  test('distinguishes PR comments from issue comments and normalizes internal events', () => {
    expect(normalizeGitHubEvent({
      projectDir: '/p',
      sourceId: 's1',
      deliveryId: 'd2',
      event: 'issue_comment',
      action: 'created',
      repo: 'acme/app',
      number: 7,
      actor: 'bob',
      payload: { issue: { pull_request: { url: 'x' } } },
      occurredAt: '2026-11-10T00:00:00.000Z',
      receivedAt: '2026-11-10T00:00:01.000Z',
    }).kind).toBe('pr_comment');

    expect(normalizeInternalEvent({
      projectDir: '/p',
      sourceId: 'internal',
      eventId: 'e1',
      kind: 'goal.result',
      aggregateId: 'g1',
      actor: 'system',
      payload: { verdict: 'PASS' },
      occurredAt: '2026-11-10T00:00:00.000Z',
      receivedAt: '2026-11-10T00:00:01.000Z',
    })).toMatchObject({
      externalKey: 'goal:g1',
      idempotencyKey: 'internal:e1',
      sourceKind: 'internal',
    });

    expect(normalizeInternalEvent({
      projectDir: '/p',
      sourceId: 'internal',
      eventId: 'decision.drafted:rec1',
      kind: 'decision.drafted',
      aggregateId: 'rec1',
      actor: 'agent',
      payload: { question: 'A or B?' },
      occurredAt: '2026-11-10T00:00:00.000Z',
      receivedAt: '2026-11-10T00:00:01.000Z',
    })).toMatchObject({
      externalKey: 'decision:rec1',
      idempotencyKey: 'internal:decision.drafted:rec1',
      sourceKind: 'internal',
    });

    expect(normalizeWebhookEvent({
      projectDir: '/p',
      sourceId: 'hooks',
      deliveryId: 'w1',
      kind: 'deploy.finished',
      actor: 'ci',
      payload: { status: 'ok' },
      occurredAt: '2026-11-10T00:00:00.000Z',
      receivedAt: '2026-11-10T00:00:01.000Z',
    })).toMatchObject({
      sourceKind: 'webhook',
      externalKey: 'webhook:hooks:w1',
      idempotencyKey: 'webhook:w1',
    });
  });
});
