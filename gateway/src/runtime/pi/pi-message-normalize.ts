/**
 * pi 历史消息 → flat（MafwMessage[]，canonical v3）。
 * ToolCall content block + ToolResultMessage（toolCallId 关联）→ 单 ToolPart；
 * toolResult 被消费不产顶层条目；part.id = toolpart_<toolCallId>（与 ToolPartAssembler 同规则，
 * live 事件与历史加载收敛同 id，store upsert 天然去重）。
 * 源：pi-ai Message = UserMessage | AssistantMessage | ToolResultMessage。
 */
import { coerceOutput } from '../tool-part-assembler';
import { MafwMessage } from '../canonical-types';

export function normalizePiMessages(raw: any[]): MafwMessage[] {
  const results = new Map<string, any>();
  for (const m of raw) {
    if (m?.role === 'toolResult' && typeof m.toolCallId === 'string') results.set(m.toolCallId, m);
  }
  const out: MafwMessage[] = [];
  let i = 0;
  for (const m of raw) {
    i++;
    const ts = typeof m?.timestamp === 'number' ? m.timestamp : 0;
    if (m?.role === 'user') {
      const text = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.map((c: any) => (c?.type === 'text' ? c.text ?? '' : '')).join('') : '');
      const id = `piu_${ts}_${i}`;
      out.push({ id, role: 'user', time: { created: ts }, content: text ? [{ id: `${id}_t`, type: 'text', text }] : [] });
      continue;
    }
    if (m?.role === 'assistant') {
      const id = `pia_${ts}_${i}`;
      const parts: any[] = [];
      let j = 0;
      for (const c of Array.isArray(m.content) ? m.content : []) {
        j++;
        if (c?.type === 'text' && c.text) {
          parts.push({ id: `${id}_t${j}`, type: 'text', text: c.text });
        } else if (c?.type === 'thinking' && c.thinking) {
          parts.push({
            id: `${id}_r${j}`, type: 'reasoning', text: c.thinking,
            ...(typeof c.thinkingSignature === 'string' && c.thinkingSignature ? { signature: c.thinkingSignature } : {}),
          });
        } else if (c?.type === 'toolCall' && typeof c.id === 'string') {
          const res = results.get(c.id);
          const input = c.arguments ?? {};
          parts.push({
            id: `toolpart_${c.id}`, type: 'tool', tool: c.name, callID: c.id,
            state: res
              ? (res.isError
                  ? { status: 'error', input, error: coerceOutput(res.content), time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } }
                  : { status: 'completed', input, output: coerceOutput(res.content), title: c.name, metadata: {}, time: { start: ts, end: typeof res.timestamp === 'number' ? res.timestamp : ts } })
              : { status: 'running', input, time: { start: ts } },
          });
        }
      }
      out.push({ id, role: 'assistant', time: { created: ts, completed: ts }, content: parts });
      continue;
    }
    // toolResult 及其他角色：已被消费或不渲染，不产顶层条目
  }
  return out;
}
