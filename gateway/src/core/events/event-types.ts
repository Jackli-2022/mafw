export type EventSourceKind = 'github' | 'cron' | 'internal' | 'webhook';

export type EventDisposition =
  | 'pending'
  | 'evaluating'
  | 'accepted'
  | 'ignored'
  | 'fanned_out'
  | 'filtered';

export type EventDeliveryState =
  | 'pending'
  | 'delivered'
  | 'read'
  | 'acknowledged'
  | 'answered'
  | 'handed_back'
  | 'failed'
  | 'dropped';

export type EventSubscriptionMode = 'work' | 'context';

export interface EventSourceRow {
  id: string;
  projectDir: string;
  kind: EventSourceKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  cursor: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EventThreadRow {
  id: string;
  sourceId: string;
  projectDir: string;
  externalKey: string;
  title: string;
  state: 'open' | 'closed' | 'archived';
  lastTriggerAt: string | null;
  createdAt: string;
}

export interface EventTriggerRow {
  id: string;
  sourceId: string;
  threadId: string;
  externalId: string;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
  idempotencyKey: string;
  disposition: EventDisposition;
}

export interface EventSubscriptionRow {
  id: string;
  threadId: string;
  subscriberType: 'standing_goal' | 'goal' | 'lead';
  subscriberId: string;
  mode: EventSubscriptionMode;
  createdAt: string;
  expiresAt: string | null;
  droppedAt: string | null;
}

export interface EventDecisionRow {
  id: string;
  threadId: string;
  triggerIds: string[];
  decision: 'accept' | 'ignore' | 'unavailable';
  mode: 'full' | 'report' | 'action' | 'skip' | null;
  goalRunId: string | null;
  rationale: string;
  decidedBy: string | null;
  createdAt: string;
}

export interface EventDeliveryRow {
  id: string;
  triggerId: string;
  subscriptionId: string;
  state: EventDeliveryState;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  ackAt: string | null;
  answeredAt: string | null;
  nextRetryAt: string | null;
}

export interface EventChannelRow {
  id: string;
  threadId: string;
  kind: 'github_comment' | 'notification' | 'chat';
  address: Record<string, unknown>;
  createdAt: string;
}

export interface EventOutboxRow {
  id: string;
  channelId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'sent' | 'failed' | 'dropped';
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventEnvelope {
  projectDir: string;
  sourceId: string;
  sourceKind: EventSourceKind;
  externalId: string;
  externalKey: string;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
  idempotencyKey: string;
  title: string;
}
