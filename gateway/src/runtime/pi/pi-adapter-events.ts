/**
 * pi raw event → AdapterEvent v1. One pure translation; no canonical envelope.
 */
import type { AdapterEvent } from '@mafw/runtime-contract';
import { normalizePiLiveMessage, piMessageIdentity, piPartId, mapPiStopReason } from './pi-message-normalize';

let sequence = 0;

let piUnknownRecorder: ((type: string) => void) | undefined;
export function setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void {
  piUnknownRecorder = fn;
}

function make(
  type: AdapterEvent['type'],
  sessionID: string,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): AdapterEvent {
  sequence += 1;
  return {
    id: `pi_${sequence}`,
    type,
    sessionID,
    at: Date.now(),
    data,
    ...extra,
  } as AdapterEvent;
}

/**
 * Translate one raw pi session event. Unknown types are recorded and dropped
 * (the adapter must never invent events).
 */
export function translatePiAdapterEvent(event: any, sessionID: string): AdapterEvent | null {
  const t = event?.type;
  if (typeof t !== 'string' || !t) return null;

  switch (t) {
    case 'agent_start':
      return make('turn.started', sessionID, {});

    case 'agent_end':
    case 'agent_settled': {
      const messages = Array.isArray(event?.messages) ? event.messages : [];
      const lastAssistant = [...messages].reverse().find((m: any) => m?.role === 'assistant');
      const stop = lastAssistant?.stopReason;
      if (stop === 'error') {
        return make('turn.failed', sessionID, {
          error: { kind: 'unknown', message: String(lastAssistant?.errorMessage ?? 'pi engine error') },
          retryable: false,
        });
      }
      if (stop === 'aborted') return make('turn.aborted', sessionID, { reason: 'aborted' });
      return make('turn.completed', sessionID, {
        ok: true,
        ...(mapPiStopReason(stop) ? { stopReason: mapPiStopReason(stop) } : {}),
      });
    }

    case 'message_start': {
      if (event?.message?.role !== 'assistant') return null;
      const message = normalizePiLiveMessage(event.message);
      if (!message) return null;
      return make('message.updated', sessionID, { message: { ...message, sessionID } });
    }
    case 'message_end': {
      const message = normalizePiLiveMessage(event?.message);
      if (!message) return null;
      return make('message.updated', sessionID, { message: { ...message, sessionID } });
    }
    case 'message_update': {
      const ame = event?.assistantMessageEvent;
      const kind = ame?.type === 'text_delta' ? 'text' : ame?.type === 'thinking_delta' ? 'reasoning' : null;
      const delta = typeof ame?.delta === 'string' ? ame.delta : '';
      const index = ame?.contentIndex;
      if (!kind || !delta || !Number.isInteger(index) || index < 0) return null;
      const messageID = piMessageIdentity(event?.message);
      if (!messageID) return null;
      return make('part.delta', sessionID, {
        messageID,
        partID: piPartId(messageID, kind, (index as number) + 1),
        field: kind,
        delta,
      });
    }

    case 'turn_start':
      return make('part.updated', sessionID, {
        part: {
          id: `pi_step_start_${sessionID}`,
          sessionID,
          messageID: `pi_step_start_${sessionID}`,
          type: 'step-start',
        },
      });
    case 'turn_end':
      return make('part.updated', sessionID, {
        part: {
          id: `pi_step_${sessionID}`,
          sessionID,
          messageID: `pi_step_${sessionID}`,
          type: 'step-finish',
        },
      });

    case 'tool_execution_start':
      return make('tool.call', sessionID, {
        callID: event?.toolCallId,
        name: event?.toolName,
        input: event?.args ?? {},
      });
    case 'tool_execution_update':
      return make('tool.delta', sessionID, {
        callID: event?.toolCallId,
        field: 'output',
        delta: event?.partialResult,
      });
    case 'tool_execution_end':
      return make('tool.result', sessionID, {
        callID: event?.toolCallId,
        ok: event?.isError !== true,
        output: event?.result,
      });

    // extension-only hook events (not reachable through session.subscribe);
    // dropped explicitly so they do not pollute unknown-event telemetry.
    case 'tool_call':
    case 'tool_result':
      return null;

    case 'permission.asked': {
      const request = {
        sessionID,
        requestId: event?.requestId,
        toolName: event?.toolName,
        args: event?.args,
        risk: event?.risk,
      };
      return make('permission.asked', sessionID, { request }, { requestID: event?.requestId });
    }
    case 'permission.replied': {
      const reply = event?.approved === false ? 'reject' : 'once';
      return make(
        'permission.replied',
        sessionID,
        { reply, approved: event?.approved !== false, source: 'user' },
        { requestID: event?.requestId },
      );
    }

    // Compaction is emitted by PiSessionRegistry directly (session.compacting/
    // session.compacted); these raw hooks are extension-only and would duplicate
    // the registry frames if pi ever surfaces them on session.subscribe.
    case 'session_before_compact':
    case 'session_compact':
    case 'session.compacting':
    case 'session.compacted':
      return null;

    default:
      try { piUnknownRecorder?.(t); } catch { /* fail-open telemetry */ }
      return null;
  }
}
