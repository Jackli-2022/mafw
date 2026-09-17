import * as http from 'http';

export interface TriageDismissDeps {
  /** automation-engine rejectTriage：PENDING → REJECTED（dismiss 与 reject 同语义——不创建 goal 直接关闭）。 */
  rejectTriage(triageId: string): boolean;
  /** 审计账本（可选，缺失时跳过不阻塞）。 */
  appendLedger?(entry: Record<string, unknown>): void;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * POST /api/triage/:id/dismiss — 忽略 triage 项（SDK triage.dismiss 的服务端落地）。
 * 语义 = reject（state REJECTED），仅账本 reason 区分（triage_dismissed），
 * 供 SDK contract 对齐：此前该路由不存在，调用会落入 dashboard 兜底返回 HTML。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleTriageDismiss(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: TriageDismissDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/triage\/([^/]+)\/dismiss(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;
  const triageId = decodeURIComponent(m[1]);

  const ok = deps.rejectTriage(triageId);
  try {
    deps.appendLedger?.({
      timestamp: new Date().toISOString(),
      event: 'AUTOMATION_TRIGGERED',
      source: 'user',
      reason: 'triage_dismissed',
      details: { triageId },
    });
  } catch { /* 账本失败不阻塞 */ }
  json(res, 200, { status: ok ? 'dismissed' : 'not_found' });
  return true;
}
