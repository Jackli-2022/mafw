import type { EventDeliveryRow, EventDeliveryState } from './event-types';

export const DELIVERY_STATES: readonly EventDeliveryState[] = [
  'pending',
  'delivered',
  'read',
  'acknowledged',
  'answered',
  'handed_back',
  'failed',
  'dropped',
];

const TRANSITIONS: Record<EventDeliveryState, readonly EventDeliveryState[]> = {
  pending: ['delivered', 'failed', 'dropped'],
  delivered: ['read', 'acknowledged', 'handed_back', 'failed', 'dropped'],
  read: ['acknowledged', 'answered', 'handed_back', 'failed', 'dropped'],
  acknowledged: ['answered', 'handed_back', 'failed', 'dropped'],
  answered: [],
  handed_back: [],
  failed: ['pending'],
  dropped: [],
};

export function canTransition(from: EventDeliveryState, to: EventDeliveryState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextRetryDelayMs(attempt: number): number {
  const safe = Math.max(1, Math.trunc(attempt));
  return Math.min(60_000, 2_000 * 2 ** (safe - 1));
}

export function applyDeliveryTransition(
  current: EventDeliveryRow,
  next: EventDeliveryState,
  now: string,
): Pick<EventDeliveryRow, 'state' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt'> {
  if (!canTransition(current.state, next)) {
    throw new Error(`invalid delivery transition: ${current.state} -> ${next}`);
  }
  return {
    state: next,
    deliveredAt: next === 'delivered' ? now : current.deliveredAt,
    readAt: next === 'read' ? now : current.readAt,
    ackAt: next === 'acknowledged' ? now : current.ackAt,
    answeredAt: next === 'answered' ? now : current.answeredAt,
  };
}
