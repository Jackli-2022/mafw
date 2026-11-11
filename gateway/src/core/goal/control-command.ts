/**
 * Goal control command handler（E1-4）。
 *
 * 语义来自 transport 里 `POST /control` 的内联 switch（大写动作族，与 SDK
 * `GoalControlAction` 一致：PAUSE / ABORT / FORCE_PHASE / RESET_PARAMETRIC）。
 * E1-4 把它提成可注入函数，让两条入口共用**同一实现**：
 *
 *   - `POST /control`            —— MCP / 旧客户端兼容路径（transport 分支）
 *   - `POST /api/goals/control`  —— SDK `goals.control` 契约路径（registry handler）
 *
 * 行为逐字保留：无论动作是否命中都返回 `{ status: 'ok' }`；动作缺失/未知同样
 * 200（旧实现的 fail-open 形状）。transport 仍把解析失败映射为 400
 * `{error:'Invalid JSON'}`（保持旧行为）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger';
import type { GatewayDatabase } from '../../memory/gateway-db';

export interface GoalControlCommandDeps {
  patchState(goalId: string, patch: Record<string, unknown>): Promise<void> | void;
  destroyAllSessions(goalId: string): Promise<void> | void;
  getActiveGoal(goalId: string): { loop?: number } | undefined;
  registeredProjects(): Iterable<[string, { mafwDir: string }]>;
  getGatewayDb(): GatewayDatabase;
  archiveGoal(goalId: string, outcome: Record<string, unknown>): Promise<void> | void;
}

export interface GoalControlCommand {
  action?: string;
  goalId?: string;
  targetPhase?: string;
  [key: string]: unknown;
}

export interface GoalControlCommandResult {
  status: number;
  body: Record<string, unknown>;
}

/** 姿态来自旧 transport 分支；返回值形状也保持一致。 */
export async function handleGoalControlCommand(
  control: GoalControlCommand,
  deps: GoalControlCommandDeps,
): Promise<GoalControlCommandResult> {
  switch (control.action) {
    case 'PAUSE':
      if (control.goalId) await deps.patchState(control.goalId, { nextAction: 'PAUSED' });
      break;
    case 'ABORT':
      if (control.goalId) {
        const goalId = control.goalId;
        await deps.destroyAllSessions(goalId);
        // W1：取消语义 = 批准门也取消（防 terminal state 下 UI 残留 pending）
        await deps.patchState(goalId, { nextAction: 'FAILED', planApproval: null });
        const state = deps.getActiveGoal(goalId);
        // Find projectDir for this goal
        let projectDir: string | null = null;
        for (const [pDir, info] of deps.registeredProjects()) {
          if (fs.existsSync(path.join(info.mafwDir, 'state', `${goalId}.json`))) {
            projectDir = pDir;
            break;
          }
        }
        if (projectDir) {
          const { recordGoalOutcome } = await import('../../orchestration/outcome-recorder.js');
          recordGoalOutcome(deps.getGatewayDb(), {
            goalId,
            verdict: 'CANCELLED',
            rounds: state?.loop ?? 0,
            lastError: 'User cancelled',
            reviewFeedback: null,
            projectDir,
            mafwDir: path.join(projectDir, '.mafw'),
            projectId: projectDir,
          });
        }
        await deps.archiveGoal(goalId, {
          verdict: 'CANCELLED',
          rounds: state?.loop ?? 0,
          lastError: 'User cancelled',
        });
      }
      break;
    case 'FORCE_PHASE':
      if (control.goalId && control.targetPhase) {
        await deps.destroyAllSessions(control.goalId);
        await deps.patchState(control.goalId, {
          nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`,
        });
      }
      break;
    case 'RESET_PARAMETRIC':
      log.info('[Scheduler] Resetting parametric cache...');
      break;
  }

  return { status: 200, body: { status: 'ok' } };
}
