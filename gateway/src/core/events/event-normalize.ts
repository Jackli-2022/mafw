import type { EventEnvelope } from './event-types';

function githubKind(event: string, action: string, payload: Record<string, unknown>): string {
  if (event === 'pull_request') {
    if (action === 'opened') return 'pr_opened';
    if (action === 'synchronize') return 'pr_sync';
    if (action === 'review_submitted') return 'pr_review';
    if (action === 'closed') return 'pr_closed';
  }
  if (event === 'issues' && action === 'opened') return 'issue_opened';
  if (event === 'issue_comment' && action === 'created') {
    const issue = payload.issue as Record<string, unknown> | undefined;
    return issue?.pull_request ? 'pr_comment' : 'issue_comment';
  }
  if (event === 'check_run' && action === 'completed') return 'ci_status';
  return `github_${event}_${action}`;
}

function titleOf(repo: string, number: number, payload: Record<string, unknown>): string {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  return title || `${repo}#${number}`;
}

export function normalizeGitHubEvent(input: {
  projectDir: string;
  sourceId: string;
  deliveryId: string;
  event: string;
  action: string;
  repo: string;
  number: number;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
}): EventEnvelope {
  const kind = githubKind(input.event, input.action, input.payload);
  return {
    projectDir: input.projectDir,
    sourceId: input.sourceId,
    sourceKind: 'github',
    externalId: input.deliveryId,
    externalKey: `${input.repo}#${input.number}`,
    kind,
    actor: input.actor,
    payload: {
      repo: input.repo,
      number: input.number,
      author: input.actor,
      ...input.payload,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    idempotencyKey: `github:${input.deliveryId}`,
    title: titleOf(input.repo, input.number, input.payload),
  };
}

export function normalizeCronTick(input: {
  projectDir: string;
  sourceId: string;
  standingGoalId: string;
  scheduledAt: string;
  actualAt: string;
}): EventEnvelope {
  return {
    projectDir: input.projectDir,
    sourceId: input.sourceId,
    sourceKind: 'cron',
    externalId: input.scheduledAt,
    externalKey: `cron:${input.standingGoalId}`,
    kind: 'cron_tick',
    actor: 'system',
    payload: {
      standingGoalId: input.standingGoalId,
      scheduledAt: input.scheduledAt,
      actualAt: input.actualAt,
    },
    occurredAt: input.scheduledAt,
    receivedAt: input.actualAt,
    idempotencyKey: `cron:${input.standingGoalId}:${input.scheduledAt}`,
    title: `cron:${input.standingGoalId}`,
  };
}

export function normalizeInternalEvent(input: {
  projectDir: string;
  sourceId: string;
  eventId: string;
  kind: string;
  aggregateId: string;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
}): EventEnvelope {
  const goalEvent = input.kind.startsWith('goal.');
  return {
    projectDir: input.projectDir,
    sourceId: input.sourceId,
    sourceKind: 'internal',
    externalId: input.eventId,
    externalKey: goalEvent ? `goal:${input.aggregateId}` : `project:${input.projectDir}`,
    kind: input.kind,
    actor: input.actor,
    payload: input.payload,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    idempotencyKey: `internal:${input.eventId}`,
    title: `${input.kind}:${input.aggregateId}`,
  };
}

export function normalizeWebhookEvent(input: {
  projectDir: string;
  sourceId: string;
  deliveryId: string;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
}): EventEnvelope {
  return {
    projectDir: input.projectDir,
    sourceId: input.sourceId,
    sourceKind: 'webhook',
    externalId: input.deliveryId,
    externalKey: `webhook:${input.sourceId}:${input.deliveryId}`,
    kind: input.kind,
    actor: input.actor,
    payload: input.payload,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    idempotencyKey: `webhook:${input.deliveryId}`,
    title: `${input.kind}:${input.deliveryId}`,
  };
}
