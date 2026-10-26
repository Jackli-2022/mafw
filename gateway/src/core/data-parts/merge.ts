/**
 * T2-3 历史合并：把 session_data_parts overlay 行追加进 wire parts。
 *
 * 规则（spec §5.4）：只合并本页现存消息；runtime 同 id 优先；坏 JSON 跳过；
 * 顺序按 created_at asc；不合成消息、不改其他字段。
 */
import type { SessionDataPartRow } from '../../memory/gateway-db';

export interface WireMessage {
  info?: { id?: string; [k: string]: unknown };
  parts?: unknown[];
  [k: string]: unknown;
}

export function mergeDataPartsIntoWire(wire: WireMessage[], rows: SessionDataPartRow[]): void {
  if (!Array.isArray(wire) || !Array.isArray(rows) || rows.length === 0) return;

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

  for (const msg of wire) {
    const messageID = msg?.info?.id;
    if (typeof messageID !== 'string' || !messageID) continue;
    const list = byMessage.get(messageID);
    if (!list) continue;
    if (!Array.isArray(msg.parts)) msg.parts = [];

    for (const row of list) {
      if (msg.parts.some((p: any) => p && typeof p === 'object' && p.id === row.id)) continue;
      let data: unknown;
      try { data = JSON.parse(row.data_json); } catch { continue; }
      msg.parts.push({
        id: row.id,
        type: row.type,
        data,
        sessionID: row.session_id,
        messageID: row.message_id,
      });
    }
  }
}
