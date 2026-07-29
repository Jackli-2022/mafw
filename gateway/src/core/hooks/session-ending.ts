import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState } from '../utils/state';

/**
 * session-ending Hook �?异常兜底
 *
 * 职责�?
 *   1. Session 正常结束时遍�?state 文件反查 sessionId
 *   2. 检�?state 是否已更新（nextAction !== WAIT_PHASE_COMPLETE�?
 *   3. 如果 Skill Entry 因为异常没来得及更新 state，写入异常状�?
 *   4. Scheduler 下一�?poll 会读取新 nextAction，重�?Session
 *
 * 设计原则�?
 *   - 只兜底，不承载主路径状态更�?
 *   - 遍历所�?state 文件，不假设 sessionId 格式包含 goalId
 *   - 如果 state 已正常更新，无操�?
 */

export interface HookContext {
  sessionId: string;
  projectDir?: string;
}

export async function sessionEndingHook(hookContext: HookContext): Promise<void> {
  const sessionId = hookContext.sessionId;
  const projectDir = hookContext.projectDir || process.cwd();
  const mafwDir = path.join(projectDir, '.mafw');
  const stateDir = path.join(mafwDir, 'state');


  // Pre-compact protection: detect high-energy memories (goal-independent)
  try {
    const parametricDir = path.join(projectDir, '.mafw/parametric');
    if (fs.existsSync(parametricDir)) {
      const files = fs.readdirSync(parametricDir).filter(f => f.endsWith('.json'));
      let highEnergyCount = 0;
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(parametricDir, file), 'utf-8'));
          if ((data.energy_score || data.energy || 0) > 0.8) highEnergyCount++;
        } catch { /* skip unparseable files */ }
      }
      if (highEnergyCount > 0) {
        console.log(`[mafw:pre-compact] Preserving ${highEnergyCount} high-energy memories`);
      }
    }
  } catch { /* ignore parametric errors */ }

  // 1. 遍历所�?state 文件，找到包含该 sessionId �?goal
  if (!fs.existsSync(stateDir)) {
    console.warn(`[hook:session-ending] State directory not found: ${stateDir}`);
    return;
  }

  const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
  let targetGoalId: string | null = null;
  let targetPhase: string | null = null;

  for (const file of stateFiles) {
    const statePath = path.join(stateDir, file);
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      for (const [phase, session] of Object.entries(state.sessions || {})) {
        const sess = session as any;
        if (sess.id === sessionId && sess.active) {
          targetGoalId = state.goalId;
          targetPhase = phase;
          break;
        }
      }
      if (targetGoalId) break;
    } catch (err: any) {
      console.warn(`[hook:session-ending] Failed to parse ${file}: ${err.message}`);
    }
  }

  if (!targetGoalId) {
    console.warn(`[hook:session-ending] No active state found for session ${sessionId}`);
    return;
  }


  // 2. 兜底检查：如果 state �?nextAction 还是 WAIT_PHASE_COMPLETE�?
  // 说明 Skill Entry 没来得及更新 state（异常或超时�?
  try {
    const state = await loadState(targetGoalId, projectDir);
    if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
      console.warn(`[hook:session-ending] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`);

      // 写入异常状态，�?Scheduler 重建
      await updateState(targetGoalId, {
        nextAction: `CREATE_${targetPhase!.toUpperCase()}_SESSION`,
        error: 'session_ended_without_state_update',
        sessions: {
          ...state.sessions,
          [targetPhase!]: {
            ...state.sessions[targetPhase!],
            destroyedAt: new Date().toISOString(),
            active: false
          }
        }
      }, projectDir);

    } else {
    }

  } catch (err: any) {
    console.error(`[hook:session-ending] Failed to load state for ${targetGoalId}: ${err.message}`);
  }
}
