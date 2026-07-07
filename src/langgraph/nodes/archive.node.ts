import { LoopStateType } from '../loop-state';

export interface ArchiveOptions {
  archiveGoal: (goalId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function archiveSuccessNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.log(`[LangGraph] Goal ${state.goalId} PASSED after ${state.round} round(s)`);
  syncToFile({ ...state, phase: 'ARCHIVED' });
  await archiveGoal(state.goalId);
  return {};
}

export async function archiveFailNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.error(`[LangGraph] Goal ${state.goalId} FAILED: ${state.lastError}`);
  syncToFile({ ...state, phase: 'FAILED' });
  await archiveGoal(state.goalId);
  return {};
}

export async function archiveMaxRetriesNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.error(`[LangGraph] Goal ${state.goalId} max retries (${state.maxRounds}) reached`);
  syncToFile({ ...state, phase: 'FAILED' });
  await archiveGoal(state.goalId);
  return {};
}
