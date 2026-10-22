/**
 * claude 事件方言 —— SDKMessage（@anthropic-ai/claude-agent-sdk 0.3.x 真型）
 * → MAFW canonical v3。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.3
 * 声明式行处理 system×3 / result×7（判别行序：aborted 先于 failed）；
 * transformEvent 处理 assistant 拆分（一进多出）/ user tool_result /
 * stream_event 分派 / turn.started 合成（模块级每回合状态）。
 *
 * 自包含要求：EventMapping 执行器为本地迷你实现（语义同 gateway
 * event-mapper 的执行器子集：mappings 序匹配 → when 条件 → fields/passProperties
 * → transformEvent 逃逸 → null=suppressed）；Task 4 的真 loader 加载测试
 * 用真执行器跑同一张表兜底语义漂移。
 */

// ─── 类型（本地声明，零 gateway 依赖） ───────────────────────────────────────

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

// ─── 迷你路径求值（event-mapper 子集） ──────────────────────────────────────

function getPath(obj: any, dotted: string): unknown {
  if (!dotted.startsWith('$')) return undefined;
  let cur: any = obj;
  for (const seg of dotted.slice(1).split('.')) {
    if (seg === '' ) continue;
    if (seg.includes('[')) {
      // 不支持（本方言无需下标）
      return undefined;
    }
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setPath(obj: Record<string, any>, dottedKey: string, value: unknown): void {
  const segs = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

function evalField(spec: FieldValue, event: any): unknown {
  if ('const' in spec) return spec.const;
  if (spec.template) {
    return spec.template.replace(/\{\$([^}]+)\}/g, (_m, p) => {
      const v = getPath(event, '$' + String(p));
      return v === undefined ? '' : String(v);
    });
  }
  if (spec.path) {
    const v = getPath(event, spec.path);
    return v === undefined ? spec.default : v;
  }
  return undefined;
}

function matchWhen(when: EventMapping['when'], event: any): boolean {
  if (!when || when.length === 0) return true;
  return when.every((c) => {
    const v = getPath(event, c.path);
    if (c.exists) return Boolean(v);
    return v === c.equals;
  });
}

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

// ─── turn.started 合成状态（每回合首条 user；result 后复位） ─────────────────

const turnStartedBySession = new Map<string, boolean>();
export { turnStartedBySession };
export function __resetClaudeTurnState(): void {
  turnStartedBySession.clear();
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

  // ---- user：turn.started 合成（每回合首条）+ message.updated + text part /
  //      tool_result → tool.result ----
  if (t === 'user') {
    const uuid = event?.uuid;
    const msgId = `clu_${uuid}`;
    const blocks: any[] = Array.isArray(event?.message?.content) ? event.message.content : [];
    const out: RawRuntimeEvent[] = [];
    if (sid && !turnStartedBySession.get(sid)) {
      turnStartedBySession.set(sid, true);
      out.push(makeEvent('turn.started', { sessionID: sid }, sid));
    }
    const hasToolResult = blocks.some((b: any) => b?.type === 'tool_result');
    if (!hasToolResult) {
      // 纯文本用户消息：消息骨架 + text part（桌面渲染路径）
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
    // tool_result 消息：每块一个 tool.result（含骨架不重复发——assistant 侧已建）
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

  // ---- result 的映射行消费后此处不见（mappings 优先）；未知类型 suppressed ----
  return null;
};

// ─── 组合执行器（mappings 序 → transform 逃逸；null=suppressed） ────────────

export function translateClaudeEvent(event: any, fallbackSessionID?: string): RawRuntimeEvent[] {
  const type = event?.type;
  if (typeof type !== 'string' || !type) return [];

  // 声明行：first-match
  for (const m of CLAUDE_EVENT_MAPPINGS) {
    const froms = Array.isArray(m.from) ? m.from : [m.from];
    if (!froms.includes(type)) continue;
    if (!matchWhen(m.when, event)) continue;
    if (m.to === 'drop') return [];
    // result 命中（任一终态行）= 回合结束：复位 turn.started 合成状态
    if (type === 'result') {
      const resultSid = (getPath(event, '$.session_id') as string) ?? fallbackSessionID;
      if (resultSid) turnStartedBySession.delete(resultSid);
    }
    const properties: Record<string, any> = {};
    const source = m.passProperties ? (getPath(event, m.passProperties) as Record<string, any>) : undefined;
    if (source && typeof source === 'object') Object.assign(properties, JSON.parse(JSON.stringify(source)));
    for (const [key, spec] of Object.entries(m.fields ?? {})) {
      const v = evalField(spec, event);
      if (v !== undefined) setPath(properties, key, v);
    }
    const sid = (getPath(event, '$.session_id') as string) ?? fallbackSessionID;
    return [makeEvent(m.to, properties, sid)];
  }

  // transform 逃逸
  const transformed = claudeTransformEvent(event);
  if (transformed == null) return [];
  return Array.isArray(transformed) ? transformed : [transformed];
}
