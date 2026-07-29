import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerGetGoalStatus: ToolHandler = async (args, services) => {
  try {
    const goalId = args.goalId as string;
    const mafwDir = services.mafwDir ?? (process.env.MAFW_PROJECT_DIR ? path.join(process.env.MAFW_PROJECT_DIR, '.mafw') : undefined) ?? path.join(process.cwd(), '.mafw');
    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Goal ${goalId} not found` }) }], isError: true };
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return { content: [{ type: 'text', text: JSON.stringify({
      success: true, goalId,
      phase: state.phase, round: state.round, verdict: state.reviewVerdict,
      lastError: state.lastError, updatedAt: state.updatedAt,
    }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
