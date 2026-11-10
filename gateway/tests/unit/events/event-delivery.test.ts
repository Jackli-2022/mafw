import {
  applyDeliveryTransition,
  canTransition,
  nextRetryDelayMs,
} from '../../../src/core/events/event-delivery';
import type { EventDeliveryRow } from '../../../src/core/events/event-types';

const delivery = (over: Partial<EventDeliveryRow> = {}): EventDeliveryRow => ({
  id: 'd1',
  triggerId: 't1',
  subscriptionId: 's1',
  state: 'pending',
  attempts: 0,
  lastError: null,
  deliveredAt: null,
  readAt: null,
  ackAt: null,
  answeredAt: null,
  nextRetryAt: null,
  ...over,
});

describe('event delivery state machine', () => {
  test('allows the delivery lifecycle and rejects backwards moves', () => {
    expect(canTransition('pending', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'read')).toBe(true);
    expect(canTransition('read', 'acknowledged')).toBe(true);
    expect(canTransition('acknowledged', 'answered')).toBe(true);
    expect(canTransition('answered', 'pending')).toBe(false);
    expect(canTransition('pending', 'acknowledged')).toBe(false);
    expect(canTransition('delivered', 'failed')).toBe(true);
    expect(canTransition('failed', 'pending')).toBe(true);
  });

  test('retry backs off from 2s to a 1min cap', () => {
    expect(nextRetryDelayMs(1)).toBe(2_000);
    expect(nextRetryDelayMs(2)).toBe(4_000);
    expect(nextRetryDelayMs(10)).toBe(60_000);
  });

  test('writes only the timestamp for the state being entered', () => {
    expect(applyDeliveryTransition(delivery(), 'delivered', '2026-11-10T00:00:00.000Z')).toMatchObject({
      state: 'delivered',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      readAt: null,
    });
    expect(() => applyDeliveryTransition(delivery({ state: 'answered' }), 'pending', '2026-11-10T00:00:00.000Z'))
      .toThrow();
  });
});
