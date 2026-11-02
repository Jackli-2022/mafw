/**
 * 迁移期可选出口：`GET /api/sessions/:id/messages?format=flat`。
 *
 * 默认出口在 Task 15 之前仍输出 opencode wire `{info, parts}`；本模块是显式
 * flat 出口的唯一实现，**不得调用 `toWireHistory`**。它与默认出口保持同等语义：
 *  - limit/before 原样转发给 runtime；
 *  - tool part enrich（`toolClass` / `canonicalTool`）经 `enrichHistoryParts`；
 *  - data-part overlay 经 `mergeDataPartsIntoFlat` 并入本页现存消息；
 *  - `nextCursor` 原样回传。
 *
 * 返回 `false` = 路径/查询不匹配（或不是 flat 请求），交回 legacy 链，默认
 * wire 行为零变化。
 */
import * as http from 'http';
import type { BusinessRuntime } from '../runtime/contract';
import type { MafwMessage } from '../runtime/canonical-types';
import type { SessionDataPartRow } from '../memory/gateway-db';
import { enrichHistoryParts } from '../runtime/tool-classes';
import { mergeDataPartsIntoFlat } from '../core/data-parts/merge-flat';

export interface SessionHistoryFlatDeps {
  getRuntime(): BusinessRuntime | null;
  /** 只返回本页消息 id 的 overlay 行；缺省表示无 overlay。 */
  listDataParts?(sessionID: string, messageIds: string[]): SessionDataPartRow[];
  /** 失败可观测入口（组合根接 gateway logger）；缺省静默 fail-open。 */
  warn?(message: string): void;
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function emptyEnvelope(res: http.ServerResponse): void {
  json(res, 200, { data: [], nextCursor: null });
}

export async function handleSessionHistoryFlat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionHistoryFlatDeps,
): Promise<boolean> {
  const match = url.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/);
  if (!match || req.method !== 'GET') return false;

  const parsed = new URL(url, `http://${req.headers?.host || 'localhost'}`);
  if (parsed.searchParams.get('format') !== 'flat') return false;

  const sessionID = match[1];
  const limit = parseInt(parsed.searchParams.get('limit') || '100', 10);
  const before = parsed.searchParams.get('before') || undefined;

  const runtime = deps.getRuntime();
  if (!runtime) {
    emptyEnvelope(res);
    return true;
  }

  try {
    const result = await runtime.session.messages({
      sessionID,
      limit: Number.isFinite(limit) ? limit : 100,
      ...(before ? { before } : {}),
    });
    // runtime facade 出口恒为 flat（normalizeFacadeHistory）；此处只做 enrich /
    // overlay，不经过任何 wire 还原。
    let messages: MafwMessage[] = Array.isArray(result?.data) ? result.data : [];
    const nextCursor = result?.nextCursor ?? null;

    try { enrichHistoryParts(messages); } catch { /* fail-open：enrich 不阻断历史 */ }

    try {
      const messageIds = messages
        .map((message) => message?.id)
        .filter((id): id is string => typeof id === 'string' && !!id);
      if (messageIds.length > 0 && deps.listDataParts) {
        const rows = deps.listDataParts(sessionID, messageIds);
        messages = mergeDataPartsIntoFlat(messages, rows);
      }
    } catch { /* fail-open：data part 合并不阻断历史 */ }

    json(res, 200, { data: messages, nextCursor });
  } catch (err: any) {
    deps.warn?.(`[SessionHistoryFlat] failed to fetch messages: ${err?.message ?? String(err)}`);
    emptyEnvelope(res);
  }
  return true;
}
