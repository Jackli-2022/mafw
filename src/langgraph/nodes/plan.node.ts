import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function planNode(
  state: LoopStateType,
  options: AgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'PLANNING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-plan ${goalId}`);

  interrupt('awaiting_plan');

  const wavesPath = path.join(mafwDir, 'waves.json');
  if (!fs.existsSync(wavesPath)) {
    return { lastError: 'waves.json not found after plan', reviewVerdict: 'ERROR' };
  }
  try {
    JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
  } catch (err: any) {
    return { lastError: `Invalid waves.json: ${err.message}`, reviewVerdict: 'ERROR' };
  }

  await destroySession(sessionId);

  syncToFile({ round: state.round, wavePlanPath: wavesPath, phase: 'PLANNING_COMPLETE' });

  return { wavePlanPath: wavesPath, round: state.round };
}
