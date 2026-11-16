import { isLeadDecisionContext, renderLeadDecisionEvent } from '../../../src/core/events/lead-event';
import type { EventSubscriptionRow, EventTriggerRow } from '../../../src/core/events/event-types';

const trigger: EventTriggerRow = {
  id: 'trigger_1',
  sourceId: 'internal',
  threadId: 'thread_1',
  externalId: 'decision.drafted:rec1',
  kind: 'decision.drafted',
  actor: 'agent',
  payload: {
    recordId: 'rec1',
    goalId: 'g1',
    question: '清理策略选 A 还是 B？',
    options: [
      { id: 'a', title: '只隐藏', summary: '可逆', risks: ['不释放磁盘'] },
      { id: 'b', title: '彻底删除', summary: '释放磁盘', risks: ['不可逆'] },
    ],
    rationale: '需要你确认保留策略',
  },
  occurredAt: '2026-11-10T00:00:00.000Z',
  receivedAt: '2026-11-10T00:00:01.000Z',
  idempotencyKey: 'internal:decision.drafted:rec1',
  disposition: 'pending',
};

function subscription(over: Partial<EventSubscriptionRow> = {}): EventSubscriptionRow {
  return {
    id: 'subscription_1',
    threadId: 'thread_1',
    subscriberType: 'lead',
    subscriberId: 'pod_1',
    mode: 'context',
    createdAt: '2026-11-10T00:00:00.000Z',
    expiresAt: null,
    droppedAt: null,
    ...over,
  };
}

describe('lead event projection', () => {
  test('renders a decision draft as a Lead message with options and a human-only reminder', () => {
    const text = renderLeadDecisionEvent(trigger);
    expect(text).toContain('[LEAD EVENT] 决定待确认');
    expect(text).toContain('rec1');
    expect(text).toContain('g1');
    expect(text).toContain('清理策略选 A 还是 B？');
    expect(text).toContain('只隐藏');
    expect(text).toContain('彻底删除');
    expect(text).toContain('不要替用户拍板');
  });

  test('ignores non-decision triggers', () => {
    const text = renderLeadDecisionEvent({ ...trigger, kind: 'goal.result', payload: {} });
    expect(text).toBe('');
  });

  test('accepts a lead context subscription only for decision events', () => {
    expect(isLeadDecisionContext({ triggers: [trigger], subscriptions: [subscription()] })).toBe(true);
    expect(isLeadDecisionContext({
      triggers: [trigger],
      subscriptions: [subscription({ subscriberType: 'standing_goal', mode: 'work' })],
    })).toBe(false);
    expect(isLeadDecisionContext({
      triggers: [trigger],
      subscriptions: [subscription({ subscriberType: 'lead', mode: 'work' })],
    })).toBe(false);
    expect(isLeadDecisionContext({
      triggers: [{ kind: 'pr_opened' }],
      subscriptions: [subscription()],
    })).toBe(false);
  });
});
