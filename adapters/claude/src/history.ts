/**
 * claude 历史 normalize —— SDK getSessionMessages → flat MafwMessage[]。
 *
 * 与 Plan 1 pi-message-normalize 同构：tool_use 块 + 后随 user 的 tool_result
 * 块（tool_use_id 关联）合并为单 ToolPart（id = toolpart_<tool_use_id>——与
 * live 侧 assembler 同 id 方案，store upsert 天然去重）；tool_result 被消费
 * 不产顶层条目；stop_reason/usage → finish/tokens 零换名透传。
 * MafwMessage 本地声明（语义同 gateway canonical-types，零依赖单文件）。
 */

export interface MafwMessage {
  id?: string;
  sessionID?: string;
  role: 'user' | 'assistant';
  content?: any[];
  time?: { created?: number; updated?: number; completed?: number };
  finish?: string;
  model?: string;
  providerID?: string;
  tokens?: Record<string, unknown>;
  cost?: number | Record<string, unknown>;
  parentID?: string;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (c?.type === 'text' && typeof c?.text === 'string' ? c.text : '')).join('');
  }
  return '';
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return contentToText(content);
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text;
    return JSON.stringify(content);
  }
  return '';
}

export function normalizeClaudeHistory(raw: any[]): MafwMessage[] {
  if (!Array.isArray(raw)) return [];

  // 第一遍：tool_use_id → tool_result 索引
  const results = new Map<string, { content: unknown; is_error?: boolean }>();
  for (const m of raw) {
    if (m?.role !== 'user' || !Array.isArray(m?.message?.content) && !Array.isArray(m?.content)) continue;
    const blocks: any[] = (Array.isArray(m?.content) ? m.content : m.message.content) ?? [];
    for (const b of blocks) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        results.set(b.tool_use_id, { content: b.content, is_error: b.is_error === true });
      }
    }
  }

  const out: MafwMessage[] = [];
  let i = 0;
  for (const m of raw) {
    i++;
    if (!m || typeof m !== 'object') continue;
    const role = m.role;
    const blocks: any[] = Array.isArray(m?.content) ? m.content
      : Array.isArray(m?.message?.content) ? m.message.content
      : (typeof (m?.content ?? m?.message?.content) === 'string' ? null : []);
    const uuid = m?.uuid ?? m?.message?.id;

    if (role === 'user') {
      const rawContent = m?.content ?? m?.message?.content;
      if (typeof rawContent === 'string') {
        out.push({ id: `clu_${uuid}`, role: 'user', content: [{ id: `clu_${uuid}_t`, type: 'text', text: rawContent }] });
        continue;
      }
      const arr = Array.isArray(rawContent) ? rawContent : [];
      const toolResults = arr.filter((b: any) => b?.type === 'tool_result');
      const texts = arr.filter((b: any) => b?.type === 'text' && typeof b?.text === 'string');
      if (toolResults.length > 0 && texts.length === 0) continue; // 纯 tool_result：已被 assistant 侧消费
      if (texts.length > 0) {
        out.push({ id: `clu_${uuid}`, role: 'user', content: texts.map((b: any, j: number) => ({ id: `clu_${uuid}_t${j}`, type: 'text', text: b.text })) });
      }
      continue;
    }

    if (role === 'assistant') {
      const id = `cla_${uuid}`;
      const parts: any[] = [];
      let j = 0;
      for (const b of Array.isArray(blocks) ? blocks : []) {
        j++;
        if (b?.type === 'text' && typeof b.text === 'string') {
          parts.push({ id: `${id}_t${j}`, type: 'text', text: b.text });
        } else if (b?.type === 'thinking' && (b.thinking || b.text)) {
          parts.push({ id: `${id}_r${j}`, type: 'reasoning', text: b.thinking ?? b.text });
        } else if (b?.type === 'tool_use' && typeof b.id === 'string') {
          const res = results.get(b.id);
          const input = b.input ?? {};
          parts.push({
            id: `toolpart_${b.id}`, type: 'tool', tool: b.name, callID: b.id,
            state: res
              ? (res.is_error
                  ? { status: 'error', input, error: toolResultText(res.content) }
                  : { status: 'completed', input, output: toolResultText(res.content), title: b.name, metadata: {} })
              : { status: 'running', input },
          });
        }
      }
      out.push({
        id, role: 'assistant', content: parts,
        ...(m?.stop_reason != null ? { finish: m.stop_reason } : {}),
        ...(m?.model ? { model: m.model } : {}),
        ...(m?.usage ? { tokens: m.usage } : {}),
      });
      continue;
    }
    // system / 其他角色：不产顶层条目
  }
  return out;
}
