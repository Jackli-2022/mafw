/**
 * T2-3 / canonical v3 历史合并（flat）：把 session_data_parts overlay 行追加进
 * MAFW flat 消息的 `content`。
 *
 * 规则与 wire 版（`merge.ts`）逐条对齐：
 *  - 只合并本页现存消息；runtime 同 id 优先；坏 JSON 跳过；
 *  - 顺序按 created_at asc；不合成消息、不改其他字段。
 *
 * 差异：flat 消息的身份在 `message.id`，内容在 `content`；采用 copy-on-write——
 * 有 overlay 的消息/内容数组新建，未命中的消息按引用放行（不污染 runtime 返回值）。
 */
import type { SessionDataPartRow } from '../../memory/gateway-db';
import type { MafwMessage, MafwPart } from '../../runtime/canonical-types';

export function mergeDataPartsIntoFlat(
  messages: MafwMessage[],
  rows: SessionDataPartRow[],
): MafwMessage[] {
  if (!Array.isArray(messages)) return messages;
  if (!Array.isArray(rows) || rows.length === 0) return messages;

  const byMessage = new Map<string, SessionDataPartRow[]>();
  for (const row of rows) {
    if (!row || typeof row.message_id !== 'string') continue;
    const list = byMessage.get(row.message_id);
    if (list) list.push(row);
    else byMessage.set(row.message_id, [row]);
  }
  for (const list of byMessage.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }

  return messages.map((message) => {
    const messageID = typeof message?.id === 'string' ? message.id : '';
    if (!messageID) return message;
    const list = byMessage.get(messageID);
    if (!list) return message;

    const existing = Array.isArray(message.content) ? message.content : [];
    const additions: MafwPart[] = [];
    for (const row of list) {
      if (existing.some((part) => part && typeof part === 'object' && part.id === row.id)) continue;
      if (additions.some((part) => part.id === row.id)) continue;
      let data: unknown;
      try { data = JSON.parse(row.data_json); } catch { continue; }
      additions.push({
        id: row.id,
        type: row.type as `data-${string}`,
        data,
        sessionID: row.session_id,
        messageID: row.message_id,
      });
    }
    if (additions.length === 0) return message;
    return { ...message, content: [...existing, ...additions] };
  });
}
