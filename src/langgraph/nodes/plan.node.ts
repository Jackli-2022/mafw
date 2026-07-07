import { LoopStateType } from '../loop-state';
import {
  createAndPromptSession,
  destroySession,
  waitForFile,
  SessionClient,
} from './session.utils';
import * as path from 'path';
import * as fs from 'fs';

export interface PlanNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
}

export async function planNode(
  state: LoopStateType,
  options: PlanNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 5 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-plan',
    goalId,
  );

  const wavesPath = path.join(mafwDir, 'waves.json');
  const found = await waitForFile(wavesPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Plan session ${sessionId} timed out waiting for waves.json`,
      reviewVerdict: 'ERROR',
    };
  }

  try {
    const content = fs.readFileSync(wavesPath, 'utf-8');
    JSON.parse(content);
  } catch (err: any) {
    return {
      lastError: `Plan output waves.json is invalid: ${err.message}`,
      reviewVerdict: 'ERROR',
    };
  }

  return {
    wavePlanPath: wavesPath,
    round: state.round,
  };
}
