import { log } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState } from '../utils/state';

/**
 * session-ending Hook —寮傚父鍏滃簳
 *
 * 鑱岃矗锛?
 *   1. Session 姝ｅ父缁撴潫鏃堕亶鍘?state 鏂囦欢鍙嶆煡 sessionId
 *   2. 检查 state 是否已更新（nextAction !== WAIT_PHASE_COMPLETE）
 *   3. 濡傛灉 Skill Entry 鍥犱负寮傚父娌℃潵寰楀強鏇存柊 state锛屽啓鍏ュ紓甯哥姸鎬?
 *   4. Scheduler 下一轮 poll 会读取新 nextAction，重建 Session
 *
 * 设计原则：
 *   - 只兜底，不承载主路径状态更新
 *   - 遍历所有 state 文件，不假设 sessionId 格式包含 goalId
 *   - 如果 state 已正常更新，无操作
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
        log.info(`[mafw:pre-compact] Preserving ${highEnergyCount} high-energy memories`);
      }
    }
  } catch { /* ignore parametric errors */ }

  // 1. 遍历所有 state 文件，找到包含该 sessionId 的 goal
  if (!fs.existsSync(stateDir)) {
    log.warn(`[hook:session-ending] State directory not found: ${stateDir}`);
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
      log.warn(`[hook:session-ending] Failed to parse ${file}: ${err.message}`);
    }
  }

  if (!targetGoalId) {
    log.warn(`[hook:session-ending] No active state found for session ${sessionId}`);
    return;
  }


  // 2. 鍏滃簳妫€鏌ワ細濡傛灉 state 鐨?nextAction 杩樻槸 WAIT_PHASE_COMPLETE锛?
  // 璇存槑 Skill Entry 娌℃潵寰楀強鏇存柊 state锛堝紓甯告垨瓒呮椂锛?
  try {
    const state = await loadState(targetGoalId, projectDir);
    if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
      log.warn(`[hook:session-ending] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`);

      // 鍐欏叆寮傚父鐘舵€侊紝璁?Scheduler 閲嶅缓
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
    log.error(`[hook:session-ending] Failed to load state for ${targetGoalId}: ${err.message}`);
  }
}



