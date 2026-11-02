/**
 * pi 历史消息 → flat（MafwMessage[]，canonical v3）。
 * ToolCall content block + ToolResultMessage（toolCallId 关联）→ 单 ToolPart；
 * toolResult 被消费不产顶层条目；part.id = toolpart_<toolCallId>（与 ToolPartAssembler 同规则，
 * live 事件与历史加载收敛同 id，store upsert 天然去重）。
 * 源：pi-ai Message = UserMessage | AssistantMessage | ToolResultMessage。
 *
 * ## 消息/part 身份（live ⇄ 历史必须同 id）
 *
 * pi 的 UserMessage 没有 id，AssistantMessage 也没有稳定 id，**两者都只有 `timestamp`**
 * （毫秒）。因此身份只能由 role + timestamp 组成：
 *
 * - 消息 id：`piu_<timestamp>`（user）/ `pia_<timestamp>`（assistant）。
 *   **绝不掺数组下标**——下标随分页裁剪 / 历史追加而变，会导致 live 与历史永远对不上。
 * - 同一次归一里出现重复的 role+timestamp 时，确定性追加序号：第 2 条 `_2`、第 3 条 `_3`
 *   （数组序决定，同一输入恒同输出）。live 侧单条消息取**基础 id**（即首次出现形态），
 *   因此 `message_start` / `part.delta` / `message_end` 与随后历史归一得到同一
 *   messageID + partID；pi 用毫秒时间戳，同一毫秒两条同角色消息实际不会发生，退化情形
 *   只有历史侧会带 `_2` 后缀（live 该消息此前已按基础 id 渲染，属已知边界）。
 * - 无 `timestamp` 的**live** 消息直接丢弃（不造假 id，见 `normalizePiLiveMessage`）；
 *   历史侧缺 timestamp 是退化输入（pi-ai 类型要求必填），回退 `*_0` 并由序号消歧。
 * - part id：assistant 内容按下标（1 起）`${msgId}_t<n>`（text）/ `${msgId}_r<n>`
 *   （reasoning），工具恒 `toolpart_<callID>`；user 文本恒 `${msgId}_t`。
 *   live 文本/推理增量用 `piPartId(msgId, kind, contentIndex + 1)`——与历史同一套编号。
 */

import { coerceOutput } from '../tool-part-assembler';
import { MafwMessage, MafwMessageError, StopReason } from '../canonical-types';

/**
 * pi StopReason（pi-ai types.d.ts）→ MAFW canonical StopReason。
 *
 * `pending`/`deferred` 都不是终态（消息还在流式/被 provider 转入异步），映射为
 * `unknown`——UI 对 unknown 静默（session-ui `stopReasonLabel`），不会误报错误。
 */
const PI_STOP_REASON: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  toolUse: 'tool_use',
  error: 'error',
  aborted: 'cancelled',
  pending: 'unknown',
  deferred: 'unknown',
};

/** pi 原生 stopReason → canonical（未知原生值 → 'unknown'；缺失 → undefined）。 */
export function mapPiStopReason(raw: unknown): StopReason | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  return PI_STOP_REASON[raw] ?? 'unknown';
}

/**
 * 消息身份（role + 毫秒 timestamp）→ 基础 id；无 timestamp / 非 chat 角色 → null。
 * live 事件据此判定「能不能安全产消息」（无 timestamp 一律不产，见文件头）。
 */
export function piMessageIdentity(m: any): string | null {
  if (m?.role !== 'user' && m?.role !== 'assistant') return null;
  if (typeof m?.timestamp !== 'number' || !Number.isFinite(m.timestamp)) return null;
  return `${m.role === 'user' ? 'piu' : 'pia'}_${m.timestamp}`;
}

/** part 身份：`${msgId}_t<n>`（text）/ `${msgId}_r<n>`（reasoning），n 从 1 起（= content 下标 + 1）。 */
export function piPartId(messageID: string, kind: 'text' | 'reasoning', index: number): string {
  return `${messageID}_${kind === 'text' ? 't' : 'r'}${index}`;
}

/**
 * pi assistant 错误 → 规范 `{kind, message}`（provider 原文优先保留）。
 * - aborted → kind 'abort'（UI 用中止分隔条表达，不渲染红卡）
 * - error → kind 'provider'（pi 的错误文本来自 provider 响应）
 * 两者都必须给非空 message（`errorCardText` 只丢空 message）。
 */
export function piMessageError(m: any): MafwMessageError | undefined {
  const stop = m?.stopReason;
  if (stop !== 'error' && stop !== 'aborted') return undefined;
  const text = typeof m?.errorMessage === 'string' ? m.errorMessage.trim() : '';
  return stop === 'aborted'
    ? { kind: 'abort', message: text || 'aborted' }
    : { kind: 'provider', message: text || 'provider error' };
}

export interface NormalizePiOptions {
  /**
   * live 事件形态（单条消息）：**不写 `time.completed`**。
   * pi 的 step 结算单载体是 `turn_end` → `step-finish`（BudgetGuard 依赖）；若 live
   * `message.updated` 也带 completed，step 切面会双计（终审 Minor #8 裁决，本批次沿用）。
   * 历史形态保留 completed（历史消息本就已结束）。
   */
  live?: boolean;
}

function timestampOf(m: any): number {
  return typeof m?.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : 0;
}

function piUserMessage(m: any, id: string): MafwMessage {
  const ts = timestampOf(m);
  const text = typeof m?.content === 'string'
    ? m.content
    : (Array.isArray(m?.content) ? m.content.map((c: any) => (c?.type === 'text' ? c.text ?? '' : '')).join('') : '');
  return {
    id,
    role: 'user',
    time: { created: ts },
    content: text ? [{ id: `${id}_t`, type: 'text', text }] : [],
  };
}

function piAssistantMessage(m: any, id: string, results: Map<string, any>, opts: NormalizePiOptions): MafwMessage {
  const ts = timestampOf(m);
  const parts: any[] = [];
  let j = 0;
  for (const c of Array.isArray(m?.content) ? m.content : []) {
    j++;
    if (c?.type === 'text' && c.text) {
      parts.push({ id: piPartId(id, 'text', j), type: 'text', text: c.text });
    } else if (c?.type === 'thinking' && (c.thinking || c.thinkingSignature)) {
      parts.push({
        id: piPartId(id, 'reasoning', j), type: 'reasoning', text: c.thinking ?? '',
        ...(typeof c.thinkingSignature === 'string' && c.thinkingSignature ? { signature: c.thinkingSignature } : {}),
      });
    } else if (c?.type === 'toolCall' && typeof c.id === 'string') {
      const res = results.get(c.id);
      const input = c.arguments ?? {};
      parts.push({
        id: `toolpart_${c.id}`, type: 'tool', tool: c.name, callID: c.id,
        ...(typeof c.thoughtSignature === 'string' && c.thoughtSignature ? { signature: c.thoughtSignature } : {}),
        state: res
          ? (res.isError
              ? { status: 'error', input, error: coerceOutput(res.content), time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } }
              : { status: 'completed', input, output: coerceOutput(res.content), title: c.name, metadata: {}, time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } })
          : { status: 'running', input, time: { start: ts } },
      });
    }
  }
  const model = typeof m?.provider === 'string' && m.provider && typeof m?.model === 'string' && m.model
    ? { providerID: m.provider, modelID: m.model }
    : undefined;
  const stopReason = mapPiStopReason(m?.stopReason);
  const error = piMessageError(m);
  return {
    id,
    role: 'assistant',
    time: opts.live ? { created: ts } : { created: ts, completed: ts },
    content: parts,
    ...(model ? { model } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(error ? { error } : {}),
  };
}

export function normalizePiMessages(raw: any[], opts: NormalizePiOptions = {}): MafwMessage[] {
  const results = new Map<string, any>();
  for (const m of raw) {
    if (m?.role === 'toolResult' && typeof m.toolCallId === 'string') results.set(m.toolCallId, m);
  }
  const out: MafwMessage[] = [];
  const seen = new Map<string, number>();
  for (const m of raw) {
    const role = m?.role;
    // toolResult / 其他角色：已被消费或不渲染，不产顶层条目
    if (role !== 'user' && role !== 'assistant') continue;
    const base = piMessageIdentity(m) ?? `${role === 'user' ? 'piu' : 'pia'}_${timestampOf(m)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}_${n}`;
    out.push(role === 'user' ? piUserMessage(m, id) : piAssistantMessage(m, id, results, opts));
  }
  return out;
}

/**
 * live 事件用：单条原生消息 → flat（基础 id、无冲突后缀、无 `time.completed`）。
 *
 * 无 `timestamp` → null（**不造假 id**）：缺身份的消息在客户端只能共享一个兜底 id，
 * assistant 会覆盖 user 回合，因此宁可不发。
 */
export function normalizePiLiveMessage(m: any): MafwMessage | null {
  if (!piMessageIdentity(m)) return null;
  const [out] = normalizePiMessages([m], { live: true });
  return out ?? null;
}
