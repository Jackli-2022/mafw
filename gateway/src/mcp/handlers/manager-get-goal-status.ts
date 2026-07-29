import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerGetGoalStatus: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
    const mafwDir = path.join(projectDir, '.mafw');
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
