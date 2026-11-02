import type { GoalStateV3 } from '../goal/state-v3';
import { isTerminalState } from '../goal/state-v3';
import { parseReviewRubric, taskIdsFromWavePlan } from '../goal/review-rubric';
import type { PodGoalVerdict } from './pod-stage';

export interface PodGoalResult {
  goalId: string;
  verdict: PodGoalVerdict | null;
  resultReady: boolean;
  goalAcceptance: string[];
  tasks: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped'; evidence: string }>;
  reviewFeedback: string;
  receipt: unknown | null;
  artifacts: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseJson(text: string | null): unknown | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function buildPodGoalResult(input: {
  goalId: string;
  state: GoalStateV3 | null;
  request: Record<string, unknown> | null;
  readText(path: string): string | null;
}): PodGoalResult {
  const { state } = input;
  const goalAcceptance = strings(input.request?.acceptance);
  if (!state) {
    return {
      goalId: input.goalId,
      verdict: null,
      resultReady: false,
      goalAcceptance,
      tasks: [],
      reviewFeedback: '',
      receipt: null,
      artifacts: [],
    };
  }

  const reviewText = state.reviewReportPath ? input.readText(state.reviewReportPath) : null;
  const receiptText = state.receiptPath ? input.readText(state.receiptPath) : null;
  const receipt = parseJson(receiptText);
  const wavesText = state.wavePlanPath ? input.readText(state.wavePlanPath) : null;
  const waves = parseJson(wavesText);

  let verdict: PodGoalVerdict | null = state.reviewVerdict ?? null;
  let tasks: PodGoalResult['tasks'] = [];
  let reviewFeedback = state.reviewFeedback || '';
  if (reviewText) {
    try {
      const rubric = parseReviewRubric(reviewText, taskIdsFromWavePlan(waves));
      verdict = rubric.verdict;
      tasks = rubric.tasks;
      reviewFeedback = rubric.feedback;
    } catch (err: any) {
      // Fail closed: a report that cannot be parsed never becomes a PASS and
      // exposes no invented per-task evidence.
      verdict = 'FAIL';
      tasks = [];
      reviewFeedback = `review report is invalid: ${err?.message ?? err}`;
    }
  }

  const artifactRefs = new Set<string>();
  for (const value of Object.values(state.artifacts ?? {})) {
    if (typeof value === 'string' && value.trim()) artifactRefs.add(value);
  }
  const receiptObj = receipt as any;
  if (receiptObj && Array.isArray(receiptObj.receipts)) {
    for (const item of receiptObj.receipts) {
      for (const file of strings(item?.files)) artifactRefs.add(file);
    }
  }

  return {
    goalId: input.goalId,
    verdict,
    resultReady: isTerminalState(state) && !!(reviewText || receiptText || artifactRefs.size > 0),
    goalAcceptance,
    tasks,
    reviewFeedback,
    receipt,
    artifacts: Array.from(artifactRefs),
  };
}
