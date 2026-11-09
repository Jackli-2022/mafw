/**
 * AdapterEvent v1 — the neutral interface between a runtime driver and the
 * gateway. No provider-native envelopes (`payload.properties`, `info/parts`)
 * may cross this boundary.
 */

export const ADAPTER_EVENT_VERSION = 1 as const;

export type AdapterEventType =
  // session lifecycle
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  | 'session.status'
  | 'session.compacting'
  | 'session.compacted'
  // turn lifecycle
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.aborted'
  | 'turn.retrying'
  | 'turn.waiting'
  | 'turn.cap_exhausted'
  // messages and parts
  | 'message.updated'
  | 'message.removed'
  | 'part.updated'
  | 'part.delta'
  | 'part.completed'
  | 'part.removed'
  | 'data.updated'
  // plan and usage
  | 'plan.updated'
  | 'usage.updated'
  // permission and questions
  | 'permission.asked'
  | 'permission.replied'
  | 'question.asked'
  | 'question.replied'
  | 'question.rejected'
  // runtime diagnostics
  | 'runtime.notice'
  | 'runtime.error'
  // tool primitives (for call/result-separated runtimes)
  | 'tool.call'
  | 'tool.delta'
  | 'tool.result'
  // shell jobs
  | 'shell.updated';

export const ADAPTER_EVENT_TYPES: readonly AdapterEventType[] = [
  'session.created', 'session.updated', 'session.deleted', 'session.status',
  'session.compacting', 'session.compacted',
  'turn.started', 'turn.completed', 'turn.failed', 'turn.aborted',
  'turn.retrying', 'turn.waiting', 'turn.cap_exhausted',
  'message.updated', 'message.removed',
  'part.updated', 'part.delta', 'part.completed', 'part.removed', 'data.updated',
  'plan.updated', 'usage.updated',
  'permission.asked', 'permission.replied',
  'question.asked', 'question.replied', 'question.rejected',
  'runtime.notice', 'runtime.error',
  'tool.call', 'tool.delta', 'tool.result',
  'shell.updated',
];

export interface AdapterEventBase<T extends AdapterEventType = AdapterEventType, D = unknown> {
  id: string;
  type: T;
  sessionID?: string;
  turnID?: string;
  itemID?: string;
  requestID?: string;
  /** epoch milliseconds */
  at: number;
  /** optional per-session monotonic sequence */
  seq?: number;
  data: D;
  /** Diagnostic only: gateway redacts, truncates and writes native.ndjson; never forwarded. */
  native?: { source: string; payload: unknown };
}

type E<T extends AdapterEventType, D = unknown> = AdapterEventBase<T, D>;

export type AdapterEvent =
  | E<'session.created'>
  | E<'session.updated'>
  | E<'session.deleted'>
  | E<'session.status'>
  | E<'session.compacting'>
  | E<'session.compacted'>
  | E<'turn.started'>
  | E<'turn.completed'>
  | E<'turn.failed'>
  | E<'turn.aborted'>
  | E<'turn.retrying'>
  | E<'turn.waiting'>
  | E<'turn.cap_exhausted'>
  | E<'message.updated'>
  | E<'message.removed'>
  | E<'part.updated'>
  | E<'part.delta'>
  | E<'part.completed'>
  | E<'part.removed'>
  | E<'data.updated'>
  | E<'plan.updated'>
  | E<'usage.updated'>
  | E<'permission.asked'>
  | E<'permission.replied'>
  | E<'question.asked'>
  | E<'question.replied'>
  | E<'question.rejected'>
  | E<'runtime.notice'>
  | E<'runtime.error'>
  | E<'tool.call'>
  | E<'tool.delta'>
  | E<'tool.result'>
  | E<'shell.updated'>;

export type AdapterEventValidation =
  | { ok: true; event: AdapterEvent }
  | { ok: false; errors: string[] };

const TYPES = new Set<string>(ADAPTER_EVENT_TYPES);
const SESSIONLESS = new Set<string>(['runtime.notice', 'runtime.error']);
const NEED_TURN = new Set<string>([
  'turn.started', 'turn.completed', 'turn.failed', 'turn.aborted',
  'turn.retrying', 'turn.waiting', 'turn.cap_exhausted',
  'usage.updated',
  'tool.call', 'tool.delta', 'tool.result',
]);
const NEED_REQUEST = new Set<string>([
  'permission.asked', 'permission.replied',
  'question.asked', 'question.replied', 'question.rejected',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateAdapterEvent(input: unknown): AdapterEventValidation {
  if (!isRecord(input)) return { ok: false, errors: ['event must be an object'] };

  const errors: string[] = [];
  const type = input.type;
  if (!nonEmptyString(type) || !TYPES.has(type)) {
    errors.push(`unknown event type: ${String(type)}`);
  }
  if (!nonEmptyString(input.id)) errors.push('id must be a non-empty string');
  if (typeof input.at !== 'number' || !Number.isFinite(input.at)) errors.push('at must be a finite number');
  if (!isRecord(input.data)) errors.push('data must be an object');
  if (input.seq !== undefined && (typeof input.seq !== 'number' || !Number.isFinite(input.seq))) {
    errors.push('seq must be a finite number when present');
  }
  if (input.native !== undefined) {
    if (!isRecord(input.native) || !nonEmptyString(input.native.source) || !('payload' in input.native)) {
      errors.push('native must be { source: string, payload: unknown } when present');
    }
  }

  if (typeof type === 'string') {
    if (!SESSIONLESS.has(type) && !nonEmptyString(input.sessionID)) {
      errors.push(`${type} requires sessionID`);
    }
    if (NEED_TURN.has(type) && !nonEmptyString(input.turnID)) {
      errors.push(`${type} requires turnID`);
    }
    if (NEED_REQUEST.has(type) && !nonEmptyString(input.requestID)) {
      errors.push(`${type} requires requestID`);
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, event: input as unknown as AdapterEvent };
}
