import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export function syncToDashboard(state: LoopStateType): void {
  const statePath = path.join(
    state.mafwDir,
    'state',
    `${state.goalId}.json`,
  );
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nextAction =
    state.reviewVerdict === 'PASS'
      ? 'COMPLETED'
      : state.lastError
        ? 'FAILED'
        : 'WAIT_PHASE_COMPLETE';

  const dashboardState = {
    version: '2',
    goalId: state.goalId,
    loop: state.round,
    phase:
      nextAction === 'COMPLETED'
        ? 'ARCHIVED'
        : nextAction === 'FAILED'
          ? 'FAILED'
          : 'PLANNING',
    nextAction,
    wavePlanPath: state.wavePlanPath,
    receiptPath: state.receiptPath,
    reviewVerdict: state.reviewVerdict,
    reviewFeedback: state.reviewFeedback,
    error: state.lastError || null,
    updatedAt: new Date().toISOString(),
  };

  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dashboardState, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);
}


