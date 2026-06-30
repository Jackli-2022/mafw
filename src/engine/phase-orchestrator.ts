import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState, StateFile } from '../utils/state';

/**
 * Phase Orchestrator — Phase 接力状态机
 *
 * 被 Skill Entry 调用，用于：
 *   1. 读取当前 Phase 状态
 *   2. 验证 Phase 转换合法性
 *   3. 执行状态转换
 *   4. 写入 artifacts 路径
 *
 * 不直接调用 LLM，只做状态管理。
 */

export interface PhaseTransition {
  from: string | null;
  to: string;
  nextAction: string;
  totalWaves?: number;
  artifacts?: Record<string, string>;
  metrics?: Record<string, number>;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  'PLANNING': ['PLANNING_COMPLETE'],
  'PLANNING_COMPLETE': ['EXECUTING'],
  'EXECUTING': ['EXECUTING_COMPLETE'],
  'EXECUTING_COMPLETE': ['REVIEWING'],
  'REVIEWING': ['REVIEWING_COMPLETE'],
  'REVIEWING_COMPLETE': ['PLANNING', 'ARCHIVED'],
  'ARCHIVED': ['COMPLETED'],
  'COMPLETED': [],
  'FAILED': []
};

const NEXT_ACTION_MAP: Record<string, string> = {
  'PLANNING_COMPLETE': 'CREATE_EXECUTE_SESSION',
  'EXECUTING_COMPLETE': 'CREATE_REVIEW_SESSION',
  'REVIEWING_COMPLETE': 'CHECK_VERDICT',
  'ARCHIVED': 'COMPLETED'
};

/**
 * 验证并执行 Phase 转换
 */
export async function transitionPhase(
  goalId: string,
  transition: PhaseTransition,
  projectDir: string = '.'
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);

  // 验证转换合法性
  const validNext = VALID_TRANSITIONS[state.phase || ''] || [];
  if (!validNext.includes(transition.to)) {
    throw new Error(`Invalid phase transition: ${state.phase} → ${transition.to}`);
  }

  // 计算 nextAction
  const nextAction = transition.nextAction || NEXT_ACTION_MAP[transition.to] || 'WAIT_PHASE_COMPLETE';

  // 更新状态
  const patch: Partial<StateFile> = {
    phase: transition.to,
    lastPhase: state.phase,
    nextAction,
    updatedAt: new Date().toISOString()
  };

  if (transition.artifacts) {
    patch.artifacts = { ...state.artifacts, ...transition.artifacts };
  }

  if (transition.totalWaves !== undefined) {
    patch.totalWaves = transition.totalWaves;
  }

  if (transition.metrics) {
    patch.metrics = transition.metrics;
  }

  return updateState(goalId, patch, projectDir);
}

/**
 * 获取当前 Phase 信息
 */
export async function getCurrentPhase(goalId: string, projectDir: string = '.'): Promise<string | null> {
  const state = await loadState(goalId, projectDir);
  return state.phase;
}

/**
 * 检查是否可以在当前 Phase 执行特定操作
 */
export async function canExecuteInPhase(
  goalId: string,
  requiredPhase: string,
  projectDir: string = '.'
): Promise<boolean> {
  const state = await loadState(goalId, projectDir);
  return state.phase === requiredPhase;
}

/**
 * 记录 Session 信息
 */
export async function recordSession(
  goalId: string,
  phase: string,
  sessionId: string,
  projectDir: string = '.'
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);
  const sessions = { ...state.sessions };
  sessions[phase] = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    active: true
  };
  return updateState(goalId, { sessions }, projectDir);
}

/**
 * 标记 Session 已销毁
 */
export async function markSessionDestroyed(
  goalId: string,
  phase: string,
  projectDir: string = '.'
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);
  const sessions = { ...state.sessions };
  if (sessions[phase]) {
    sessions[phase] = {
      ...sessions[phase],
      destroyedAt: new Date().toISOString(),
      active: false
    };
  }
  return updateState(goalId, { sessions }, projectDir);
}

/**
 * 更新 Wave 进度
 */
export async function updateWaveProgress(
  goalId: string,
  currentWave: number,
  totalWaves: number,
  projectDir: string = '.'
): Promise<StateFile> {
  return updateState(goalId, { currentWave, totalWaves }, projectDir);
}

/**
 * 检查是否应该进入下一轮 Loop
 */
export async function shouldStartNextLoop(
  goalId: string,
  projectDir: string = '.'
): Promise<{ should: boolean; reason: string }> {
  const state = await loadState(goalId, projectDir);
  const req = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.opencode/mafw/requests', `${goalId}.json`), 'utf-8')
  );

  if (state.loop >= req.maxLoops) {
    return { should: false, reason: `maxLoops reached (${state.loop}/${req.maxLoops})` };
  }

  return { should: true, reason: 'next loop available' };
}

/**
 * 进入下一轮 Loop
 */
export async function startNextLoop(
  goalId: string,
  projectDir: string = '.'
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);
  return updateState(goalId, {
    loop: state.loop + 1,
    phase: 'PLANNING',
    lastPhase: state.phase,
    currentWave: 0,
    totalWaves: null,
    sessions: {},
    nextAction: 'CREATE_PLAN_SESSION',
    artifacts: {},
    error: undefined
  }, projectDir);
}
