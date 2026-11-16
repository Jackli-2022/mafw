// gateway/src/core/pod/pod-event-model.ts
// Deterministic severity rules for Pod events. No LLM: which channel hears
// about an event is a fixed table, so it is predictable and free to evaluate.
import { isFailedVerdict } from './pod-stage';

export type PodEventSeverity = 'p1' | 'p2' | 'p3';
export type PodEventReason = 'decision' | 'result' | 'blocked' | 'progress' | 'message';
export type PodEventAudience = 'human' | 'lead' | 'none';

export interface PodEventClass {
  kind: string;
  severity: PodEventSeverity;
  audience: PodEventAudience;
  reason: PodEventReason;
}

export type PodGoalArchiveVerdict =
  | 'PASS'
  | 'FAIL'
  | 'MAX_RETRIES'
  | 'ERROR'
  | 'UNREVIEWED'
  | 'CANCELLED';

/** A terminal Goal always reaches a person or the Lead — except when the user cancelled it.
 *  Failures wake the Lead (p1/lead); successful/unreviewed results reach the human inbox. */
export function classifyGoalArchive(input: { verdict: PodGoalArchiveVerdict | null }): PodEventClass {
  if (input.verdict === null || input.verdict === 'CANCELLED') {
    return { kind: 'goal.ended', severity: 'p3', audience: 'none', reason: 'progress' };
  }
  if (isFailedVerdict(input.verdict)) {
    return { kind: 'goal.failed', severity: 'p1', audience: 'lead', reason: 'blocked' };
  }
  return { kind: 'goal.result', severity: 'p1', audience: 'human', reason: 'result' };
}

/** `request` / `escalation` addressed to the Lead are the only p2 sources. */
export function classifyMemberMessage(input: {
  kind: string;
  toMemberId: string | null;
  leadMemberId: string | null;
}): PodEventClass {
  const addressedToLead =
    input.toMemberId !== null && input.leadMemberId !== null && input.toMemberId === input.leadMemberId;
  if (addressedToLead && (input.kind === 'request' || input.kind === 'escalation')) {
    return { kind: `member.${input.kind}`, severity: 'p2', audience: 'lead', reason: 'blocked' };
  }
  return { kind: `member.${input.kind}`, severity: 'p3', audience: 'none', reason: 'message' };
}

/** Revision is part of a Goal result's identity: a rejected plan re-runs into r2.
 *  The event kind is included so goal.failed and goal.result never dedupe each other. */
export function goalDedupeKey(goalId: string, revision: number, kind = 'goal.result'): string {
  return `${kind}:${goalId}:r${revision}`;
}

export function memberDedupeKey(kind: string, messageId: string, toMemberId: string | null): string {
  return `member.${kind}:${messageId}:${toMemberId ?? '*'}`;
}
