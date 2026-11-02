/**
 * `GET /api/sessions/:id/messages` —— MAFW flat 历史的唯一出口。
 *
 * 默认且唯一输出 `{ data: MafwMessage[], nextCursor }`（spec 2026-11-02 §9.1）：
 *  - limit/before 原样转发给 runtime；
 *  - tool part enrich（`toolClass` / `canonicalTool`）经 `enrichHistoryParts`；
 *  - data-part overlay 经 `mergeDataPartsIntoFlat` 并入本页现存消息；
 *  - `nextCursor` 原样回传。
 *
 * 不存在 wire `{info, parts}` 分支，也不接受 `format` 参数；返回 `false` 仅表示
 * 路径/方法不匹配（调用方已按 GET 路由匹配，正常路径恒 `true`）。
 */
import * as http from 'http';
import type { BusinessRuntime } from '../runtime/contract';
import type { MafwMessage } from '../runtime/canonical-types';
import type { SessionDataPartRow } from '../memory/gateway-db';
import { enrichHistoryParts } from '../runtime/tool-classes';
import { mergeDataPartsIntoFlat } from '../core/data-parts/merge-flat';

export interface SessionHistoryDeps {
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

export async function handleSessionHistory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionHistoryDeps,
): Promise<boolean> {
  const match = url.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/);
  if (!match || req.method !== 'GET') return false;

  const parsed = new URL(url, `http://${req.headers?.host || 'localhost'}`);
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
    deps.warn?.(`[SessionHistory] failed to fetch messages: ${err?.message ?? String(err)}`);
    emptyEnvelope(res);
  }
  return true;
}
