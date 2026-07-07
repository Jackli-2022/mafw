import { LoopStateType } from '../loop-state';
import {
  createAndPromptSession,
  destroySession,
  waitForFile,
  SessionClient,
} from './session.utils';
import * as path from 'path';

export interface ExecuteNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
}

export async function executeNode(
  state: LoopStateType,
  options: ExecuteNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 10 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-execute',
    goalId,
  );

  const receiptsDir = path.join(mafwDir, 'receipts', goalId);
  const receiptPath = path.join(receiptsDir, 'loop-receipt.json');
  const found = await waitForFile(receiptPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Execute session ${sessionId} timed out waiting for receipts`,
      reviewVerdict: 'ERROR',
    };
  }

  return { receiptPath };
}
