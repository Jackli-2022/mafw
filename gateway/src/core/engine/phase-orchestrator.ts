import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState, StateFile } from '../utils/state';
import { log } from '../utils/logger';

/**
 * Simplified Phase Orchestrator — no state machine logic.
 * LangGraph handles all orchestration decisions.
 * This file only exists for skill entry backward compatibility.
 */

export interface PhaseTransition {
  from: string | null;
  to: string;
  nextAction?: string;
  totalWaves?: number;
  artifacts?: Record<string, string>;
  metrics?: Record<string, number>;
  error?: string;
}

/** Info needed to record a goal-session mapping in gateway.db */
export interface GoalSessionInfo {
  goalId: string;
  sessionId: string;
  phase: string;
  loop: number;
}

export async function transitionPhase(
  goalId: string,
  transition: PhaseTransition,
  projectDir: string = '.'
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);

  const patch: Partial<StateFile> = {
    phase: transition.to,
    lastPhase: state.phase,
    updatedAt: new Date().toISOString()
  };

  if (transition.nextAction) {
    patch.nextAction = transition.nextAction;
  }
  if (transition.artifacts) {
    patch.artifacts = { ...state.artifacts, ...transition.artifacts };
  }
  if (transition.totalWaves !== undefined) {
    patch.totalWaves = transition.totalWaves;
  }
  if (transition.metrics) {
    patch.metrics = transition.metrics;
  }
  if (transition.error !== undefined) {
    patch.error = transition.error;
  }

  return updateState(goalId, patch, projectDir);
}

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
 * Record session in gateway.db goal_sessions table.
 * Called by index.ts orchestrator bridge after recordSession writes state file.
 * Separated to keep phase-orchestrator free of GatewayDatabase import.
 */
export function recordSessionInDb(
  db: { addGoalSession(s: { goal_id: string; session_id: string; phase: string; loop: number }): void },
  info: GoalSessionInfo
): void {
  try {
    db.addGoalSession({
      goal_id: info.goalId,
      session_id: info.sessionId,
      phase: info.phase,
      loop: info.loop,
    });
  } catch (err: any) {
    log.warn(`[Orchestrator] recordSessionInDb failed (non-fatal): ${err.message}`);
  }
}

export async function updateWaveProgress(
  goalId: string,
  currentWave: number,
  totalWaves: number,
  projectDir: string = '.'
): Promise<StateFile> {
  return updateState(goalId, { currentWave, totalWaves }, projectDir);
}

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
    nextAction: 'WAIT_PHASE_COMPLETE',
    artifacts: {},
    error: undefined
  }, projectDir);
}

export async function getCurrentPhase(goalId: string, projectDir: string = '.'): Promise<string | null> {
  const state = await loadState(goalId, projectDir);
  return state.phase;
}

export async function canExecuteInPhase(
  goalId: string,
  requiredPhase: string,
  projectDir: string = '.'
): Promise<boolean> {
  const state = await loadState(goalId, projectDir);
  return state.phase === requiredPhase;
}

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

export async function shouldStartNextLoop(
  goalId: string,
  projectDir: string = '.'
): Promise<{ should: boolean; reason: string }> {
  const state = await loadState(goalId, projectDir);
  const reqPath = path.join(projectDir, '.mafw/requests', `${goalId}.json`);
  if (!fs.existsSync(reqPath)) {
    return { should: true, reason: 'no request file, allowing' };
  }
  const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
  if (state.loop >= req.maxLoops) {
    return { should: false, reason: `maxLoops reached (${state.loop}/${req.maxLoops})` };
  }
  return { should: true, reason: 'next loop available' };
}

export async function handleLoopEvent(
  goalId: string,
  trigger: string,
  data?: any,
  loopNum?: number,
  projectDir: string = '.'
): Promise<boolean> {
  return true;
}
