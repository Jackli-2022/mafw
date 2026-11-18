import { describe, expect, test } from 'bun:test';
import {
  buildLeadExternalInbox,
  formatDeliveryMeta,
  relativeDeliveryTime,
} from './lead-external-inbox';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');

function thread(over: Record<string, unknown>) {
  return { id: 'th1', sourceId: 'gh', title: 'T', externalKey: 'acme/repo#1', ...over } as any;
}
function sub(over: Record<string, unknown>) {
  return { id: 's1', subscriberType: 'lead', subscriberId: 'pod1', mode: 'context', ...over } as any;
}
function delivery(over: Record<string, unknown>) {
  return {
    id: 'd1', triggerId: 't1', subscriptionId: 's1', state: 'delivered',
    deliveredAt: '2026-11-18T11:58:00.000Z', ...over,
  } as any;
}

describe('buildLeadExternalInbox', () => {
  test('keeps the lead deliveries for this pod, newest first, capped at five', () => {
    const items = buildLeadExternalInbox({
      podId: 'pod1',
      threads: [thread({ id: 'th1' })],
      sources: [{ id: 'gh', kind: 'github' }],
      subscriptions: { th1: [sub({ id: 's1' })] },
      deliveries: {
        th1: [
          delivery({ id: 'old', deliveredAt: '2026-11-18T10:00:00.000Z' }),
          delivery({ id: 'new', deliveredAt: '2026-11-18T11:59:00.000Z' }),
          delivery({ id: 'mid', deliveredAt: '2026-11-18T11:00:00.000Z' }),
        ],
      },
    });

    expect(items.map((item) => item.deliveryId)).toEqual(['new', 'mid', 'old']);
    expect(items[0]).toMatchObject({
      threadId: 'th1',
      title: 'T',
      sourceKind: 'github',
      sourceLabel: 'GitHub',
      state: 'delivered',
    });
  });

  test('ignores other subscribers, other pods, and already answered deliveries', () => {
    const items = buildLeadExternalInbox({
      podId: 'pod1',
      threads: [thread({ id: 'th1' })],
      sources: [{ id: 'gh', kind: 'github' }],
      subscriptions: {
        th1: [
          sub({ id: 'lead1' }),
          sub({ id: 'lead2', subscriberId: 'pod2' }),
          sub({ id: 'work1', subscriberType: 'standing_goal', subscriberId: 'goal1' }),
        ],
      },
      deliveries: {
        th1: [
          delivery({ id: 'mine', subscriptionId: 'lead1' }),
          delivery({ id: 'other-pod', subscriptionId: 'lead2' }),
          delivery({ id: 'other-kind', subscriptionId: 'work1' }),
          delivery({ id: 'answered', subscriptionId: 'lead1', state: 'answered' }),
          delivery({ id: 'acknowledged', subscriptionId: 'lead1', state: 'acknowledged' }),
        ],
      },
    });

    expect(items.map((item) => item.deliveryId)).toEqual(['mine']);
  });

  test('ignores internal event threads', () => {
    const items = buildLeadExternalInbox({
      threads: [thread({ id: 'th1', sourceId: 'internal' })],
      sources: [{ id: 'internal', kind: 'internal' }],
      subscriptions: { th1: [sub({ id: 's1' })] },
      deliveries: { th1: [delivery({ subscriptionId: 's1' })] },
    });

    expect(items).toEqual([]);
  });

  test('falls back to the external key and a generic source label', () => {
    const items = buildLeadExternalInbox({
      threads: [thread({ id: 'th1', title: '  ', externalKey: 'cron:tick', sourceId: 'src-x' })],
      sources: [],
      subscriptions: { th1: [sub({ id: 's1' })] },
      deliveries: { th1: [delivery({ subscriptionId: 's1' })] },
    });

    expect(items[0]).toMatchObject({ title: 'cron:tick', sourceKind: 'event', sourceLabel: 'Event' });
  });
});

describe('relativeDeliveryTime', () => {
  test('formats seconds, minutes, hours and days', () => {
    expect(relativeDeliveryTime('2026-11-18T11:59:30.000Z', NOW)).toBe('刚刚');
    expect(relativeDeliveryTime('2026-11-18T11:58:00.000Z', NOW)).toBe('2 分钟前');
    expect(relativeDeliveryTime('2026-11-18T09:00:00.000Z', NOW)).toBe('3 小时前');
    expect(relativeDeliveryTime('2026-11-16T12:00:00.000Z', NOW)).toBe('2 天前');
  });

  test('returns an empty string for a missing or invalid timestamp', () => {
    expect(relativeDeliveryTime(null, NOW)).toBe('');
    expect(relativeDeliveryTime('not-a-date', NOW)).toBe('');
  });
});

describe('formatDeliveryMeta', () => {
  test('joins the source label and relative time', () => {
    expect(formatDeliveryMeta({
      sourceLabel: 'GitHub', deliveredAt: '2026-11-18T11:58:00.000Z', state: 'read',
    }, NOW)).toBe('GitHub · 2 分钟前');
  });

  test('shows answered instead of the timestamp once handled', () => {
    expect(formatDeliveryMeta({
      sourceLabel: 'Webhook', deliveredAt: '2026-11-18T11:58:00.000Z', state: 'answered',
    }, NOW)).toBe('Webhook · 已回答');
  });
});
