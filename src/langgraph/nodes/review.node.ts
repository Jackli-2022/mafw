import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface ReviewAgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export interface VerdictResult {
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  feedback: string;
}

export function parseReviewVerdict(content: string): VerdictResult {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }

  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) {
      return { verdict: 'PASS', feedback: content.slice(0, 200) };
    }
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

export async function reviewNode(
  state: LoopStateType,
  options: ReviewAgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'REVIEWING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-review ${goalId}`);

  interrupt('awaiting_review');

  const reviewPath = path.join(mafwDir, 'reviews', `${goalId}-loop${state.round}.md`);
  if (!fs.existsSync(reviewPath)) {
    return { lastError: 'review report not found', reviewVerdict: 'ERROR' };
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const verdict = parseReviewVerdict(content);

  await destroySession(sessionId);

  syncToFile({
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
    phase: 'REVIEWING_COMPLETE',
  });

  return {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
  };
}
