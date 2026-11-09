/**
 * AdapterEvent v1 → existing canonical envelope + gateway-internal events.
 *
 * This is the only place that turns the neutral ISA into `payload.properties`
 * for the legacy canonical pipeline. It is a pure function; no IO.
 */
import type { AdapterEvent } from './adapter-event';
import type { RawRuntimeEvent } from './normalize';
import { isMafwMessage, isMafwPart } from './canonical-types';

export type InternalAdapterEvent = {
  type: 'turn.completed' | 'turn.failed' | 'turn.aborted' | 'turn.retrying'
    | 'turn.waiting' | 'turn.cap_exhausted' | 'runtime.notice' | 'runtime.error'
    | 'message.removed' | 'part.removed' | 'shell.updated';
  sessionID?: string;
  turnID?: string;
  data: unknown;
};

export interface MappedAdapterEvent {
  canonical?: RawRuntimeEvent;
  internal?: InternalAdapterEvent;
  dropped?: { reason: string };
}

function canonical(type: string, properties: Record<string, unknown>, sessionID?: string): RawRuntimeEvent {
  return {
    payload: { type, properties },
    ...(sessionID ? { sessionID } : {}),
  };
}

function dataOf(event: AdapterEvent): Record<string, any> {
  return (event.data ?? {}) as Record<string, any>;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function internal(event: AdapterEvent, type: InternalAdapterEvent['type']): InternalAdapterEvent {
  return { type, sessionID: event.sessionID, turnID: event.turnID, data: event.data };
}

export function mapAdapterEvent(event: AdapterEvent): MappedAdapterEvent {
  const data = dataOf(event);
  switch (event.type) {
    case 'session.created': {
      const session = data.session ?? data.info;
      if (!isRecord(session) || !session.id) return { dropped: { reason: 'session.created payload has no session id' } };
      return { canonical: canonical('session.created', { info: session }, event.sessionID) };
    }
    case 'session.updated': {
      const patch = data.patch ?? data.info;
      if (!isRecord(patch)) return { dropped: { reason: 'session.updated payload has no patch' } };
      return { canonical: canonical('session.updated', { info: { id: event.sessionID, ...patch } }, event.sessionID) };
    }
    case 'session.deleted':
      return { canonical: canonical('session.deleted', { sessionID: event.sessionID }, event.sessionID) };
    case 'session.status':
      return { canonical: canonical('session.updated', { info: { id: event.sessionID, status: data.status } }, event.sessionID) };
    case 'session.compacting':
      return { canonical: canonical('session.compacting', { sessionID: event.sessionID }, event.sessionID) };
    case 'session.compacted':
      return { canonical: canonical('session.compacted', { sessionID: event.sessionID }, event.sessionID) };

    case 'turn.started':
      return { canonical: canonical('turn.started', { sessionID: event.sessionID, turnID: event.turnID, ...(data.model ? { model: data.model } : {}), ...(data.agent ? { agent: data.agent } : {}) }, event.sessionID) };
    case 'turn.completed':
      return {
        canonical: canonical('turn.completed', {
          sessionID: event.sessionID, turnID: event.turnID, ok: data.ok !== false,
          ...(data.stopReason ? { stopReason: data.stopReason } : {}),
          ...(data.usage ? { usage: data.usage } : {}),
          ...(typeof data.costUsd === 'number' ? { cost: data.costUsd } : {}),
        }, event.sessionID),
        internal: internal(event, 'turn.completed'),
      };
    case 'turn.failed':
      return {
        canonical: canonical('turn.failed', {
          sessionID: event.sessionID, turnID: event.turnID,
          error: data.error?.message ?? data.message ?? 'runtime error',
          ...(data.kind ? { kind: data.kind } : {}),
          ...(data.retryable !== undefined ? { retryable: data.retryable } : {}),
        }, event.sessionID),
        internal: internal(event, 'turn.failed'),
      };
    case 'turn.aborted':
      return {
        canonical: canonical('turn.aborted', { sessionID: event.sessionID, turnID: event.turnID, ...(data.reason ? { reason: data.reason } : {}) }, event.sessionID),
        internal: internal(event, 'turn.aborted'),
      };
    case 'turn.retrying':
      return { internal: internal(event, 'turn.retrying') };
    case 'turn.waiting':
      return { internal: internal(event, 'turn.waiting') };
    case 'turn.cap_exhausted':
      return { internal: internal(event, 'turn.cap_exhausted') };

    case 'message.updated':
      if (!isMafwMessage(data.message)) return { dropped: { reason: 'message.updated payload is not a MafwMessage' } };
      return { canonical: canonical('message.updated', { message: data.message }, event.sessionID) };
    case 'message.removed':
      return { internal: internal(event, 'message.removed') };
    case 'part.updated':
      if (!isMafwPart(data.part)) return { dropped: { reason: 'part.updated payload is not a MafwPart' } };
      return { canonical: canonical('part.updated', { part: data.part }, event.sessionID) };
    case 'part.delta':
      return { canonical: canonical('part.delta', {
        sessionID: event.sessionID, messageID: data.messageID, partID: data.partID,
        field: data.field, delta: data.delta,
      }, event.sessionID) };
    case 'part.completed':
      if (!isMafwPart(data.part)) return { dropped: { reason: 'part.completed payload is not a MafwPart' } };
      return { canonical: canonical('part.complete', { part: data.part }, event.sessionID) };
    case 'part.removed':
      return { internal: internal(event, 'part.removed') };
    case 'data.updated':
      return { canonical: canonical('part.updated', { part: {
        id: data.id ?? `data_${event.id}`,
        sessionID: event.sessionID,
        messageID: data.messageID,
        type: `data-${String(data.name)}`,
        data: data.data,
        ...(data.transient ? { transient: true } : {}),
      } }, event.sessionID) };

    case 'plan.updated': {
      const items = data.items ?? data.todos;
      if (!Array.isArray(items)) return { dropped: { reason: 'plan.updated payload has no items' } };
      return { canonical: canonical('plan.updated', { sessionID: event.sessionID, todos: items }, event.sessionID) };
    }
    case 'usage.updated':
      if (!isRecord(data.usage)) return { dropped: { reason: 'usage.updated payload has no usage' } };
      return { canonical: canonical('usage.updated', {
        sessionID: event.sessionID, turnID: event.turnID,
        usage: data.usage, ...(data.contextTokens !== undefined ? { contextTokens: data.contextTokens } : {}),
        ...(data.contextWindow !== undefined ? { contextWindow: data.contextWindow } : {}),
      }, event.sessionID) };

    case 'permission.asked':
      if (!isRecord(data.request)) return { dropped: { reason: 'permission.asked payload has no request' } };
      return { canonical: canonical('permission.asked', { ...data.request, ...data }, event.sessionID) };
    case 'permission.replied':
      return { canonical: canonical('permission.replied', {
        sessionID: event.sessionID, requestId: event.requestID,
        reply: data.reply, source: data.source, ...(data.message ? { message: data.message } : {}),
      }, event.sessionID) };
    case 'question.asked':
      if (!isRecord(data.request)) return { dropped: { reason: 'question.asked payload has no request' } };
      return { canonical: canonical('question.asked', { ...data.request, ...data }, event.sessionID) };
    case 'question.replied':
      return { canonical: canonical('question.replied', { sessionID: event.sessionID, requestId: event.requestID, answers: data.answers }, event.sessionID) };
    case 'question.rejected':
      return { canonical: canonical('question.rejected', { sessionID: event.sessionID, requestId: event.requestID }, event.sessionID) };

    case 'runtime.notice':
      return { internal: internal(event, 'runtime.notice') };
    case 'runtime.error':
      if (event.turnID) {
        return {
          canonical: canonical('turn.failed', {
            sessionID: event.sessionID, turnID: event.turnID,
            error: data.message ?? 'runtime error',
            ...(data.retryable !== undefined ? { retryable: data.retryable } : {}),
          }, event.sessionID),
          internal: internal(event, 'runtime.error'),
        };
      }
      return { internal: internal(event, 'runtime.error') };

    case 'tool.call':
      return { canonical: canonical('tool.call', {
        sessionID: event.sessionID, callID: data.callID, tool: data.name,
        input: data.input, ...(data.title ? { title: data.title } : {}),
      }, event.sessionID) };
    case 'tool.delta':
      return { canonical: canonical('tool.delta', {
        sessionID: event.sessionID, callID: data.callID,
        kind: data.field, text: data.delta,
      }, event.sessionID) };
    case 'tool.result':
      return { canonical: canonical('tool.result', {
        sessionID: event.sessionID, callID: data.callID,
        output: data.output, isError: data.ok === false,
        ...(data.error ? { error: data.error } : {}),
      }, event.sessionID) };

    case 'shell.updated':
      return { internal: internal(event, 'shell.updated') };
  }
}
