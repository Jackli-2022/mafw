import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface ExecuteAgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function executeNode(
  state: LoopStateType,
  options: ExecuteAgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'EXECUTING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-execute ${goalId}`);

  interrupt('awaiting_execution');

  const receiptsDir = path.join(mafwDir, 'receipts', goalId);
  const receiptPath = path.join(receiptsDir, 'loop-receipt.json');
  if (!fs.existsSync(receiptPath)) {
    return { lastError: 'receipts not found after execute', reviewVerdict: 'ERROR' };
  }

  await destroySession(sessionId);

  syncToFile({ receiptPath, phase: 'EXECUTING_COMPLETE' });

  return { receiptPath };
}
