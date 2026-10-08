// gateway/src/core/goal/recovery.ts
import { NodeDriver } from './driver';
import { loadGoalState, isTerminalState } from './state-v3';

export interface RecoveryStateRef { goalId: string; mafwDir: string }

export interface RecoveryDeps {
  driver: NodeDriver;
  states: RecoveryStateRef[];
  probeSession?: (sessionID: string) => Promise<'alive' | 'dead'>;
}

/** 启动扫描：非终态 goal 全部 examine（产物优先/重试/归档）。 */
export async function recoverGoals(deps: RecoveryDeps): Promise<void> {
  for (const s of deps.states) {
    const state = loadGoalState(s.mafwDir, s.goalId);
    if (!state || isTerminalState(state)) continue;
    try {
      await deps.driver.examineStaleNode(s.goalId, { probeSession: deps.probeSession });
    } catch { /* fail-open：单 goal 失败不阻塞其他 */ }
  }
}

/** 周期扫描（挂 startBackupPolling）：nodeSession 超时 → examine。 */
export async function watchdogScan(
  deps: RecoveryDeps & { now?: number; timeoutMs?: number },
): Promise<void> {
  const now = deps.now ?? Date.now();
  const timeoutMs = deps.timeoutMs ?? 30 * 60_000;
  for (const s of deps.states) {
    const state = loadGoalState(s.mafwDir, s.goalId);
    if (!state || isTerminalState(state) || !state.nodeSession) continue;
    const started = Date.parse(state.nodeSession.startedAt);
    if (Number.isFinite(started) && now - started > timeoutMs) {
      try {
        await deps.driver.examineStaleNode(s.goalId, { probeSession: deps.probeSession });
      } catch { /* fail-open */ }
    }
  }
}
