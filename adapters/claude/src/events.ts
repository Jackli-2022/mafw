/**
 * claude 事件方言 —— SDKMessage（@anthropic-ai/claude-agent-sdk 0.3.x 真型）
 * → MAFW canonical v3。**纯声明面**：本文件只导出数据表 + transformEvent 逃逸口，
 * 执行器是 gateway 的 applyEventMappings（raw-event-first，spec 2026-10-31 §4.1）。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.3 claude 节
 * 审计事实源: 2026-10-21-runtime-canonical-v3-mapping-audit.md §2 claude 列
 *
 * turn.started 合成 / result 复位不在本文件：gateway 执行器 first-match 命中映射行后
 * 不会调 transformEvent，跨事件状态机由 runtime-kit 的 createTurnTracker 在 raw 流上完成。
 */

// ─── 类型（本地声明，零 gateway 依赖；形状由 gateway 契约测试钉扎） ──────────

export interface EventSourceShape {
  typePath: string;
  sessionIdPath?: string | string[];
  directoryPath?: string;
}
export interface FieldValue {
  path?: string; default?: unknown; const?: unknown; template?: string;
}
export interface EventMapping {
  from: string | string[];
  to: string;
  when?: Array<{ path: string; equals?: unknown; exists?: true }>;
  passProperties?: string;
  fields?: Record<string, FieldValue>;
}
export type TransformEventFn = (event: any) => any | any[] | null | undefined;
export interface RawRuntimeEvent {
  payload: { type: string; properties: Record<string, any> };
  sessionID?: string;
  directory?: string;
}

export const CLAUDE_EVENT_SOURCE: EventSourceShape = {
  typePath: '$.type',
  sessionIdPath: '$.session_id',
};

// ─── 声明式映射行 ────────────────────────────────────────────────────────────

const resultRow = (
  to: string,
  when: EventMapping['when'],
): EventMapping => ({
  from: 'result', to, when,
  fields: {
    sessionID: { path: '$.session_id' },
    usage: { path: '$.usage' },
    cost: { path: '$.total_cost_usd' },
    turns: { path: '$.num_turns' },
    durationMs: { path: '$.duration_ms' },
    finishReason: { path: '$.terminal_reason' },
  },
});

export const CLAUDE_EVENT_MAPPINGS: EventMapping[] = [
  // ---- system 族 ----
  {
    from: 'system', to: 'session.created',
    when: [{ path: '$.subtype', equals: 'init' }],
    fields: {
      sessionID: { path: '$.session_id' },
      model: { path: '$.model' },
      permissionMode: { path: '$.permissionMode' },
    },
  },
  {
    from: 'system', to: 'session.compacting',
    when: [{ path: '$.subtype', equals: 'status' }, { path: '$.status', equals: 'compacting' }],
    fields: { sessionID: { path: '$.session_id' } },
  },
  {
    from: 'system', to: 'session.compacted',
    when: [{ path: '$.subtype', equals: 'compact_boundary' }],
    fields: { sessionID: { path: '$.session_id' } },
  },
  // ---- result 三终态（行序敏感：aborted 判别先于 error 兜底） ----
  resultRow('turn.aborted', [{ path: '$.terminal_reason', equals: 'aborted_streaming' }]),
  resultRow('turn.aborted', [{ path: '$.terminal_reason', equals: 'aborted_tools' }]),
  resultRow('turn.completed', [{ path: '$.subtype', equals: 'success' }]),
  resultRow('turn.failed', [{ path: '$.subtype', equals: 'error_max_turns' }]),
  resultRow('turn.failed', [{ path: '$.subtype', equals: 'error_during_execution' }]),
  resultRow('turn.failed', [{ path: '$.subtype', equals: 'error_max_budget_usd' }]),
  resultRow('turn.failed', [{ path: '$.subtype', equals: 'error_max_structured_output_retries' }]),
  // system 其他 subtype（informational/api_retry/…）与 result 未知组合 → 不声明，
  // transformEvent 不处理 → suppressed（可观测计数；词汇漂移探测器同款）
];

// ─── turn 边界谓词（runtime-kit tracker 使用） ──────────────────────────────

/** 首条 user 消息 = 回合起点（后续 user 消息是 tool_result，不会重复合成）。 */
export function isClaudeTurnStart(raw: any): boolean {
  return raw?.type === 'user';
}

/** result = 回合终态（reset tracker 状态）。 */
export function isClaudeTerminal(raw: any): boolean {
  return raw?.type === 'result';
}

// ─── transformEvent（assistant / user / stream_event） ──────────────────────

function makeEvent(type: string, properties: Record<string, any>, sessionID?: string): RawRuntimeEvent {
  return { payload: { type, properties }, ...(sessionID !== undefined ? { sessionID } : {}) };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (c?.type === 'text' && typeof c?.text === 'string' ? c.text : '')).join('');
  }
  return '';
}

export const claudeTransformEvent: TransformEventFn = (event: any) => {
  const t = event?.type;
  const sid: string | undefined = event?.session_id ?? event?.sessionID;

  // ---- assistant：message.updated(flat) + 每 content block 一事件 ----
  if (t === 'assistant') {
    const msg = event?.message ?? {};
    const uuid = event?.uuid ?? msg?.id;
    const out: RawRuntimeEvent[] = [
      makeEvent('message.updated', {
        ...(sid ? { sessionID: sid } : {}),
        message: {
          id: `cla_${uuid}`,
          role: 'assistant',
          ...(msg?.stop_reason !== undefined && msg?.stop_reason !== null ? { finish: msg.stop_reason } : {}),
          ...(msg?.model ? { model: msg.model } : {}),
          ...(msg?.usage ? { tokens: msg.usage } : {}),
        },
      }, sid),
    ];
    let i = 0;
    for (const block of Array.isArray(msg?.content) ? msg.content : []) {
      i++;
      if (block?.type === 'text' && typeof block.text === 'string') {
        out.push(makeEvent('part.updated', {
          ...(sid ? { sessionID: sid } : {}),
          part: { id: `cla_${uuid}_t${i}`, type: 'text', text: block.text, ...(sid ? { sessionID: sid } : {}), messageID: `cla_${uuid}` },
        }, sid));
      } else if (block?.type === 'thinking' && (block.thinking || block.text)) {
        out.push(makeEvent('part.updated', {
          ...(sid ? { sessionID: sid } : {}),
          part: { id: `cla_${uuid}_r${i}`, type: 'reasoning', text: block.thinking ?? block.text, ...(typeof block.signature === 'string' ? { signature: block.signature } : {}), ...(sid ? { sessionID: sid } : {}), messageID: `cla_${uuid}` },
        }, sid));
      } else if (block?.type === 'tool_use' && typeof block.id === 'string') {
        out.push(makeEvent('tool.call', {
          callID: block.id,
          tool: block.name,
          input: block.input ?? {},
          ...(sid ? { sessionID: sid } : {}),
          messageID: `cla_${uuid}`,
        }, sid));
      }
    }
    return out;
  }

  // ---- user：message.updated + text part / tool_result → tool.result ----
  // turn.started 由 tracker 在 raw 流上合成（本函数不产生合成状态）。
  if (t === 'user') {
    const uuid = event?.uuid;
    const msgId = `clu_${uuid}`;
    const blocks: any[] = Array.isArray(event?.message?.content) ? event.message.content : [];
    const out: RawRuntimeEvent[] = [];
    const hasToolResult = blocks.some((b: any) => b?.type === 'tool_result');
    if (!hasToolResult) {
      out.push(makeEvent('message.updated', {
        ...(sid ? { sessionID: sid } : {}),
        message: { id: msgId, role: 'user' },
      }, sid));
      const text = contentToText(event?.message?.content);
      if (text) {
        out.push(makeEvent('part.updated', {
          ...(sid ? { sessionID: sid } : {}),
          part: { id: `${msgId}_t`, type: 'text', text, ...(sid ? { sessionID: sid } : {}), messageID: msgId },
        }, sid));
      }
      return out;
    }
    for (const b of blocks) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        out.push(makeEvent('tool.result', {
          callID: b.tool_use_id,
          output: typeof b.content === 'string' ? b.content : contentToText(b.content),
          ...(b.is_error === true ? { isError: true } : { isError: false }),
          ...(sid ? { sessionID: sid } : {}),
        }, sid));
      }
    }
    return out;
  }

  // ---- stream_event：content_block_delta 三分派 ----
  if (t === 'stream_event') {
    const delta = event?.event?.delta;
    if (!delta || event?.event?.type !== 'content_block_delta') return null;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      return [makeEvent('part.delta', {
        field: 'text', delta: delta.text,
        ...(sid ? { sessionID: sid } : {}),
      }, sid)];
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      return [makeEvent('part.delta', {
        field: 'text', delta: delta.thinking,
        ...(sid ? { sessionID: sid } : {}),
      }, sid)];
    }
    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const callID = event?.parent_tool_use_id ?? undefined;
      return [makeEvent('tool.delta', {
        kind: 'input', text: delta.partial_json,
        ...(callID ? { callID } : {}),
        ...(sid ? { sessionID: sid } : {}),
      }, sid)];
    }
    return null;
  }

  return null;
};
