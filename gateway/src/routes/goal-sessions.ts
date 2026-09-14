import * as http from 'http';

export interface GoalSessionRow {
  session_id: string;
  phase: string;
  loop: number;
}

export interface GoalSessionsDeps {
  /** gateway.db listGoalSessions（goal_sessions 表）。 */
  listGoalSessions(goalId: string): Promise<GoalSessionRow[]> | GoalSessionRow[];
  /** 会话信息富化（runtime session.get）；缺失/失败不填 title，不阻塞。 */
  getSession?(sessionID: string): Promise<any> | any;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * GET /api/goals/:id/sessions — goal 的 session 映射（编排可视化下钻）。
 * 数据源 goal_sessions 表（phase-orchestrator onSessionCreated 追加），
 * 按 runtime session.get 富化 title/time（fail-open）。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleGoalSessions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: GoalSessionsDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/goals\/([^/]+)\/sessions(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  const goalId = decodeURIComponent(m[1]);

  try {
    const rows = await deps.listGoalSessions(goalId);
    const sessions = await Promise.all(
      (rows ?? []).map(async (r) => {
        const out: Record<string, unknown> = {
          sessionID: r.session_id,
          phase: r.phase,
          loop: r.loop,
        };
        try {
          const info = deps.getSession ? await deps.getSession(r.session_id) : null;
          if (info) {
            if (typeof info.title === 'string') out.title = info.title;
            if (info.time) out.time = info.time;
          }
        } catch { /* 富化 fail-open */ }
        return out;
      }),
    );
    json(res, 200, { sessions });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
