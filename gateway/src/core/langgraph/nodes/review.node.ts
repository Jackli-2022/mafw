import { LoopStateType } from '../loop-state';
import { matchesSignature } from '../signature-detector';
import * as path from 'path';
import * as fs from 'fs';

/** Maximum number of times the same signature question can be asked before forcing a decision */
const MAX_SAME_SIG_QUESTIONS = 3;

export interface AgentServices {
  client: {
    session: {
      create(opts: { directory: string }): Promise<{ id: string }>;
      promptAsync(opts: { sessionID: string; parts: Array<{ type: string; text: string }> }): Promise<void>;
      delete(opts: { sessionID: string }): Promise<void>;
    };
  };
  syncToFile: (state: Partial<LoopStateType>) => void;
  onSessionCreated?: (info: { goalId: string; sessionId: string; phase: string; loop: number }) => void;
}

function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseReviewVerdict(content: string): { verdict: 'PASS' | 'FAIL' | 'ERROR'; feedback: string } {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }
  try {
    const data = JSON.parse(content);
    return { verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL', feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}) };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) return { verdict: 'PASS', feedback: content.slice(0, 200) };
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

export async function reviewNode(
  state: LoopStateType,
  services: AgentServices,
): Promise<Partial<LoopStateType>> {
  const { client, syncToFile } = services;
  const { goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'REVIEWING' });

  const session = await client.session.create({ directory: projectDir! });
  const sessionId = session.id;
  services.onSessionCreated?.({ goalId: goalId!, sessionId, phase: 'review', loop: state.round });
  await client.session.promptAsync({ sessionID: sessionId, parts: [{ type: 'text', text: `/skill mafw-review ${goalId}` }] });

  const reviewPath = path.join(state.mafwDir!, 'reviews', `${state.goalId!}-loop${state.round}.md`);
  if (!fs.existsSync(reviewPath)) {
    return { lastError: 'review report not found', reviewVerdict: 'ERROR' as const };
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const verdict = parseReviewVerdict(content);

  const result: Partial<LoopStateType> = {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
    round: state.round + 1,
    stateVersion: (state.stateVersion ?? 0) + 1,
  };

  if (verdict.verdict === 'FAIL' && state.round < state.maxRounds) {
    const prevFeedback = state.reviewFeedback;
    const sameSignature = prevFeedback && matchesSignature(prevFeedback, verdict.feedback);
    const sameSigCount = state.sameSigCount;
    const newSameSigCount = sameSignature ? sameSigCount + 1 : 1;

    // Only ask user if we haven't exceeded the cap
    if (sameSignature && newSameSigCount >= 2 && newSameSigCount <= MAX_SAME_SIG_QUESTIONS) {
      result.pendingQuestion = {
        questionId: generateQuestionId(),
        node: 'review',
        loop: state.round,
        questions: [`Review keeps failing with same issue: ${verdict.feedback}. Continue retrying?`],
        askedAt: new Date().toISOString(),
      };
    }
    
    result.sameSigCount = newSameSigCount;
  }

  await client.session.delete({ sessionID: sessionId });
  syncToFile({ ...result, phase: 'REVIEWING_COMPLETE' });

  return result;
}

export { parseReviewVerdict };
