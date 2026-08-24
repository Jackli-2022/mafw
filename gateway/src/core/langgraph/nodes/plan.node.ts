import { LoopStateType } from '../loop-state';
import { AgentServices } from '../../langchain/node-runner';
import * as path from 'path';
import * as fs from 'fs';

function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function finalizeWithAnswer(state: LoopStateType): Promise<Partial<LoopStateType>> {
  return {
    draftPlan: null,
    pendingQuestion: null,
    userResponse: null,
    round: state.round,
    wavePlanPath: state.wavePlanPath ?? null,
    reviewFeedback: state.userResponse?.answer
      ? `Plan refined with user input: ${state.userResponse.answer}`
      : undefined,
  };
}

export async function planNode(
  state: LoopStateType,
  services: AgentServices,
): Promise<Partial<LoopStateType>> {
  const { client, syncToFile } = services;
  const { goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'PLANNING' });

  if (state.draftPlan && state.userResponse) {
    const refined = await finalizeWithAnswer(state);
    syncToFile({ ...refined, phase: 'PLANNING_COMPLETE' });
    return { ...refined, draftPlan: null, pendingQuestion: null, userResponse: null };
  }

  const session = await client.session.create({ directory: projectDir! });
  const sessionId = session.id;
  await client.session.promptAsync({ sessionID: sessionId, parts: [{ type: 'text', text: `/skill mafw-plan ${goalId}` }] });

  const wavePlanPath = path.join(state.mafwDir!, 'waves.json');
  if (!fs.existsSync(wavePlanPath)) {
    return { lastError: 'waves.json not found after plan', reviewVerdict: 'ERROR' as const };
  }

  let wavesData: any;
  try {
    wavesData = JSON.parse(fs.readFileSync(wavePlanPath, 'utf-8'));
  } catch (err: any) {
    return { lastError: `Invalid waves.json: ${err.message}`, reviewVerdict: 'ERROR' as const };
  }

  const needsClarification = wavesData.status === 'need_clarification';
  const result: Partial<LoopStateType> = {
    wavePlanPath,
    round: state.round,
    draftPlan: needsClarification ? wavesData : null,
    pendingQuestion: needsClarification
      ? {
          questionId: generateQuestionId(),
          node: 'plan',
          loop: state.round,
          questions: wavesData.ambiguities || [],
          askedAt: new Date().toISOString(),
        }
      : null,
  };

  try {
    await client.session.delete({ sessionID: sessionId });
  } catch {
    // non-fatal: session may have already been cleaned up
  }
  syncToFile({ ...result, phase: 'PLANNING_COMPLETE' });

  return result;
}
