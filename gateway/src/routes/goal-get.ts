/**
 * GET /api/goals/:id — 单个 Goal 视图（E1-4 / A5）。
 *
 * 修复：catalog 里 `goals.get` 一直是 shadow 条目（无 handler），请求落进
 * transport 的 dashboard `/api/goals` 前缀兜底 → 返回**列表**。SDK
 * `goals.get(id)` 因此永远拿不到单对象。
 *
 * 解析口径与 `goals-inline.ts`（timeline / plan）一致：
 *   goalDriverMafwDirCache[goalId] ?? findGoalStatePath(goalId).info.mafwDir
 *   → loadGoalState(mafwDir, goalId)（swept/未落盘时回落 activeGoals 内存态）
 *
 * 返回形状 = SDK `Goal`（packages/gateway-sdk/src/types.ts）：goalId / phase /
 * loop / currentWave / totalWaves / nextAction / error / updatedAt（dashboard
 * 列表同源字段 + 波次信息）。未找到 → 404 `{error:'goal not found: <id>'}`。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { loadGoalState } from '../core/goal/state-v3';
import type { RouteRegistry } from './registry';

export interface GoalStateLike {
  goalId?: string | null;
  phase?: string | null;
  loop?: number | null;
  currentWave?: number | null;
  totalWaves?: number | null;
  nextAction?: string | null;
  lastError?: string | null;
  error?: string | null;
  updatedAt?: string | null;
}

/** SDK `Goal` 形状（client.ts / types.ts 消费）。 */
export interface GoalView {
  goalId: string;
  phase: string | null;
  loop: number;
  currentWave: number;
  totalWaves: number;
  nextAction?: string;
  error: string | null;
  updatedAt: string | null;
}

export interface GoalGetDeps {
  /** `kernel.findGoalStatePath` —— 定位 state 文件与所属 mafwDir。 */
  findGoalStatePath(goalId: string): { statePath: string; info: { mafwDir: string } } | null;
  /** live cache（goalDriver 注册过的 goalId → mafwDir）。 */
  goalDriverMafwDirCache?: () => Map<string, string>;
  /** 可注入的 state 解析（默认真实 `loadGoalState`）。 */
  loadGoalState?: (mafwDir: string, goalId: string) => GoalStateLike | null;
  /** 进程内活跃态兜底（state 文件尚未落盘时）。 */
  activeGoals?: () => Map<string, GoalStateLike>;
}

/** state → SDK Goal 视图（缺失字段补默认值，形状稳定）。 */
export function projectGoalView(goalId: string, state: GoalStateLike): GoalView {
  const nextAction = state.nextAction ?? undefined;
  return {
    goalId: state.goalId ?? goalId,
    phase: state.phase ?? null,
    loop: state.loop ?? 0,
    currentWave: state.currentWave ?? 0,
    totalWaves: state.totalWaves ?? 0,
    ...(nextAction !== undefined ? { nextAction } : {}),
    error: state.error ?? state.lastError ?? null,
    updatedAt: state.updatedAt ?? null,
  };
}

export function attachGoalGetRoute(registry: RouteRegistry, deps: GoalGetDeps): void {
  registry.attachHandler('goals.get', async (
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => {
    const goalId = decodeURIComponent(params.id ?? '');
    const mafwDir = deps.goalDriverMafwDirCache?.().get(goalId)
      ?? deps.findGoalStatePath(goalId)?.info.mafwDir;
    const load = deps.loadGoalState ?? loadGoalState;
    const state = (mafwDir ? load(mafwDir, goalId) : null)
      ?? deps.activeGoals?.().get(goalId)
      ?? null;

    res.setHeader('Content-Type', 'application/json');
    if (!state) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `goal not found: ${goalId}` }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(projectGoalView(goalId, state)));
  });
}
