/** Raw claude SDK messages → neutral AdapterEvent v1. */
import type { AdapterEvent } from '@mafw/runtime-contract';

let counter = 0;
function id(): string {
  counter += 1;
  return `cla-evt-${Date.now().toString(36)}-${counter}`;
}

function make(type: AdapterEvent['type'], sessionID: string, turnID: string, data: unknown): AdapterEvent {
  return { id: id(), type, sessionID, turnID, at: Date.now(), data } as AdapterEvent;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('');
  }
  return '';
}

export interface ClaudeDeltaState {
  messageID?: string;
  partIDs?: { text?: string; reasoning?: string };
}

export function claudeAdapterEvents(
  raw: any,
  ctx: { sessionID?: string; turnID?: string; state?: ClaudeDeltaState },
): AdapterEvent[] {
  const sid: string | undefined = ctx.sessionID ?? raw?.session_id ?? raw?.sessionID ?? raw?.payload?.properties?.sessionID;
  if (!sid) return [];
  const turnID = ctx.turnID ?? '';
  const out: AdapterEvent[] = [];

  // The local tracker synthesizes these envelopes on the old runtime bus.
  const envelopeType = raw?.payload?.type;
  if (envelopeType) {
    if (envelopeType === 'turn.started') {
      out.push(make('turn.started', sid, turnID, {}));
    } else if (envelopeType === 'turn.failed') {
      out.push(make('turn.failed', sid, turnID, { error: { kind: 'unknown', message: String(raw?.payload?.properties?.error ?? 'claude runtime error') } }));
    }
    return out;
  }

  const t = raw?.type;
  if (t === 'system') {
    if (raw.subtype === 'init') {
      out.push(make('session.created', sid, turnID, { session: { id: sid, directory: raw.cwd, title: raw.title } }));
    } else if (raw.subtype === 'status' && raw.status === 'compacting') {
      out.push(make('session.compacting', sid, turnID, {}));
    } else if (raw.subtype === 'compact_boundary') {
      out.push(make('session.compacted', sid, turnID, {}));
    }
    return out;
  }

  if (t === 'assistant') {
    const msg = raw.message ?? {};
    const uuid = raw.uuid ?? msg.id ?? id();
    const messageID = `cla_${uuid}`;
    if (ctx.state) {
      ctx.state.messageID = messageID;
      ctx.state.partIDs = {};
    }
    out.push(make('message.updated', sid, turnID, {
      message: {
        id: messageID,
        sessionID: sid,
        role: 'assistant',
        ...(msg.model ? { model: { providerID: 'anthropic', modelID: String(msg.model) } } : {}),
        ...(msg.stop_reason ? { stopReason: msg.stop_reason } : {}),
      },
    }));
    let i = 0;
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      i += 1;
      if (block?.type === 'text' && typeof block.text === 'string') {
        const partID = `${messageID}_t${i}`;
        if (ctx.state) ctx.state.partIDs!.text = partID;
        out.push(make('part.updated', sid, turnID, { part: { id: partID, sessionID: sid, messageID, type: 'text', text: block.text } }));
      } else if (block?.type === 'thinking' && (block.thinking || block.text)) {
        const partID = `${messageID}_r${i}`;
        if (ctx.state) ctx.state.partIDs!.reasoning = partID;
        out.push(make('part.updated', sid, turnID, {
          part: {
            id: partID, sessionID: sid, messageID, type: 'reasoning',
            text: block.thinking ?? block.text,
            ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
          },
        }));
      } else if (block?.type === 'tool_use' && typeof block.id === 'string') {
        out.push(make('tool.call', sid, turnID, { callID: block.id, name: block.name, input: block.input ?? {}, messageID }));
      }
    }
    return out;
  }

  if (t === 'user') {
    const uuid = raw.uuid ?? id();
    const messageID = `clu_${uuid}`;
    const blocks: any[] = Array.isArray(raw.message?.content) ? raw.message.content : [];
    const hasToolResult = blocks.some((b) => b?.type === 'tool_result');
    if (!hasToolResult) {
      out.push(make('message.updated', sid, turnID, { message: { id: messageID, sessionID: sid, role: 'user' } }));
      const text = textOf(raw.message?.content);
      if (text) out.push(make('part.updated', sid, turnID, { part: { id: `${messageID}_t`, sessionID: sid, messageID, type: 'text', text } }));
      return out;
    }
    for (const block of blocks) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        out.push(make('tool.result', sid, turnID, {
          callID: block.tool_use_id,
          ok: block.is_error !== true,
          output: typeof block.content === 'string' ? block.content : textOf(block.content),
        }));
      }
    }
    return out;
  }

  if (t === 'stream_event') {
    const delta = raw?.event?.delta;
    if (!delta || raw?.event?.type !== 'content_block_delta') return out;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      out.push(make('part.delta', sid, turnID, {
        messageID: ctx.state?.messageID,
        partID: ctx.state?.partIDs?.text,
        field: 'text',
        delta: delta.text,
      }));
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      out.push(make('part.delta', sid, turnID, {
        messageID: ctx.state?.messageID,
        partID: ctx.state?.partIDs?.reasoning,
        field: 'reasoning',
        delta: delta.thinking,
      }));
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      out.push(make('tool.delta', sid, turnID, { callID: raw.parent_tool_use_id, field: 'input', delta: delta.partial_json }));
    }
    return out;
  }

  if (t === 'result') {
    const reason = String(raw.terminal_reason ?? raw.subtype ?? '');
    if (raw.subtype === 'success') {
      out.push(make('turn.completed', sid, turnID, {
        ok: true,
        usage: raw.usage,
        ...(typeof raw.total_cost_usd === 'number' ? { costUsd: raw.total_cost_usd } : {}),
      }));
      if (raw.usage) {
        out.push(make('usage.updated', sid, turnID, {
          usage: raw.usage,
          ...(typeof raw.total_cost_usd === 'number' ? { costUsd: raw.total_cost_usd } : {}),
        }));
      }
    } else if (reason === 'aborted_streaming' || reason === 'aborted_tools' || raw.subtype === 'aborted_streaming' || raw.subtype === 'aborted_tools') {
      out.push(make('turn.aborted', sid, turnID, { reason }));
    } else {
      out.push(make('turn.failed', sid, turnID, { error: { kind: 'unknown', message: String(raw.result ?? raw.subtype ?? 'claude error') } }));
    }
  }
  return out;
}
