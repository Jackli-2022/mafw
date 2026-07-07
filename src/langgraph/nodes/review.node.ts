import { LoopStateType } from '../loop-state';
import {
  createAndPromptSession,
  destroySession,
  waitForFile,
  SessionClient,
} from './session.utils';
import * as path from 'path';
import * as fs from 'fs';

export interface ReviewNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
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
  options: ReviewNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 5 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-review',
    goalId,
  );

  const reviewPath = path.join(
    mafwDir,
    'reviews',
    `${goalId}-loop${state.round}.md`,
  );
  const found = await waitForFile(reviewPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Review session ${sessionId} timed out waiting for review report`,
      reviewVerdict: 'ERROR',
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(reviewPath, 'utf-8');
  } catch (err: any) {
    return {
      lastError: `Cannot read review report at ${reviewPath}: ${err.message}`,
      reviewVerdict: 'ERROR',
    };
  }

  const verdict = parseReviewVerdict(content);

  return {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
  };
}
