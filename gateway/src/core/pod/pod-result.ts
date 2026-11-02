import * as path from 'path';

import type { GoalEval, GoalEvalCondition } from '../goal/goal-eval';
import { requiredConditionIds, validateGoalEval } from '../goal/goal-eval';
import type { ReviewGoalResult } from '../goal/review-rubric';
import { parseReviewRubric, taskIdsFromWavePlan } from '../goal/review-rubric';
import type { GoalStateV3 } from '../goal/state-v3';
import { effectiveRevision, isTerminalState } from '../goal/state-v3';
import type { PodGoalVerdict } from './pod-stage';

/**
 * 结果不可信的失败分类（fail-closed）。`null` = 结果自洽；其余值说明结果页
 * 只能展示原始证据，不得宣称验收通过：
 * - `review_missing`：终态 PASS 但没有可读的 review 报告（没有证据的 PASS）；
 * - `review_invalid`：review 报告不可解析 / 逐任务或逐条件 rubric 自相矛盾；
 * - `goal_conditions_missing`：评审没有覆盖每条必需 Goal 条件；
 * - `goal_eval_invalid`：Goal Eval 产物存在但不可解析（无法判断要求哪些条件）。
 */
export type PodGoalResultFailure =
  | 'review_missing'
  | 'review_invalid'
  | 'goal_conditions_missing'
  | 'goal_eval_invalid';

export interface PodGoalResult {
  goalId: string;
  /** 该结果对应的 revision（legacy 行为 1）。 */
  revision: number;
  verdict: PodGoalVerdict | null;
  resultReady: boolean;
  /** 申请时的 Goal acceptance（legacy 文本，保留原文）。 */
  goalAcceptance: string[];
  /** Goal Eval 条件（Task 7）；eval 缺失/非法时为空且 goalEvalValid=false。 */
  goalConditions: GoalEvalCondition[];
  /** Reviewer 的逐条件判定（Task 8）；缺失/非法时一律为空，不臆造证据。 */
  goalResults: ReviewGoalResult[];
  goalEvalValid: boolean;
  /** 结果不可信时的失败分类；可信为 null。 */
  failure: PodGoalResultFailure | null;
  tasks: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped'; evidence: string }>;
  reviewFeedback: string;
  receipt: unknown | null;
  artifacts: string[];
}

/** Goal Eval 产物路径：`<mafwDir>/goals/<goalId>/goal-eval.json`（goal-dir 布局）。
 *  goalId 只保留安全字符；纯 `.`/`..`/标点会被折叠成 `_`（绝不产生 `goals/../…`）。 */
export function goalEvalPathFor(mafwDir: string, goalId: string): string {
  const cleaned = goalId.replace(/[^A-Za-z0-9._-]/g, '_');
  const safeGoalId = /[A-Za-z0-9]/.test(cleaned) ? cleaned : '_';
  return path.join(mafwDir, 'goals', safeGoalId, 'goal-eval.json');
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface GoalEvalSource {
  /** 是否存在 Goal Eval 产物（显式入参 / 可读文件）。 */
  present: boolean;
  raw: unknown;
  /** 产物存在但不可解析（JSON 坏了）——与「没有 eval」必须区分。 */
  invalid: string | null;
}

function resolveGoalEval(
  input: { goalId: string; goalEval?: unknown; goalEvalPath?: string; readText(path: string): string | null },
  state: GoalStateV3,
): GoalEvalSource {
  if (input.goalEval !== undefined && input.goalEval !== null) {
    return { present: true, raw: input.goalEval, invalid: null };
  }
  const target = input.goalEvalPath
    ?? (state.mafwDir ? goalEvalPathFor(state.mafwDir, state.goalId || input.goalId) : null);
  if (!target) return { present: false, raw: null, invalid: null };
  const text = input.readText(target);
  if (text == null || !text.trim()) return { present: false, raw: null, invalid: null };
  try {
    return { present: true, raw: JSON.parse(text), invalid: null };
  } catch {
    return { present: true, raw: null, invalid: `goal eval is not valid JSON: ${target}` };
  }
}

function classifyRubricFailure(code: string | undefined): PodGoalResultFailure {
  return code === 'missing_goal_conditions' ? 'goal_conditions_missing' : 'review_invalid';
}

export function buildPodGoalResult(input: {
  goalId: string;
  state: GoalStateV3 | null;
  request: Record<string, unknown> | null;
  readText(path: string): string | null;
  /** 显式 revision（结果页按 revision 取）；缺省 = state.revision。 */
  revision?: number;
  /** 已解析的 Goal Eval（优先于读取文件）。 */
  goalEval?: unknown;
  /** 显式 Goal Eval 路径（缺省 = goal-dir 约定路径）。 */
  goalEvalPath?: string;
}): PodGoalResult {
  const { state } = input;
  const goalAcceptance = strings(input.request?.acceptance);
  const revision = input.revision ?? (state ? effectiveRevision(state) : 1);
  if (!state) {
    return {
      goalId: input.goalId,
      revision,
      verdict: null,
      resultReady: false,
      goalAcceptance,
      goalConditions: [],
      goalResults: [],
      goalEvalValid: false,
      failure: null,
      tasks: [],
      reviewFeedback: '',
      receipt: null,
      artifacts: [],
    };
  }

  // Goal Eval 先于评审解析：必需条件 id 是 rubric 的覆盖下限（spec §7.2）。
  const evalSource = resolveGoalEval(input, state);
  let goalEval: GoalEval | null = null;
  let goalEvalError: string | null = evalSource.invalid;
  if (evalSource.present && !evalSource.invalid) {
    try {
      goalEval = validateGoalEval(evalSource.raw);
    } catch (err) {
      goalEvalError = `goal eval is invalid: ${errorMessage(err)}`;
    }
  }
  const requiredIds = goalEval ? requiredConditionIds(goalEval) : [];

  const reviewText = state.reviewReportPath ? input.readText(state.reviewReportPath) : null;
  const receiptText = state.receiptPath ? input.readText(state.receiptPath) : null;
  const receipt = parseJson(receiptText);
  const wavesText = state.wavePlanPath ? input.readText(state.wavePlanPath) : null;
  const waves = parseJson(wavesText);

  let verdict: PodGoalVerdict | null = state.reviewVerdict ?? null;
  let tasks: PodGoalResult['tasks'] = [];
  let goalResults: ReviewGoalResult[] = [];
  let reviewFeedback = state.reviewFeedback || '';
  let failure: PodGoalResultFailure | null = null;

  if (reviewText) {
    try {
      const rubric = parseReviewRubric(reviewText, taskIdsFromWavePlan(waves), requiredIds);
      verdict = rubric.verdict;
      tasks = rubric.tasks;
      goalResults = rubric.goalResults;
      reviewFeedback = rubric.feedback;
    } catch (err: any) {
      // Fail closed: a report that cannot be parsed never becomes a PASS and
      // exposes no invented per-task/per-condition evidence.
      verdict = 'FAIL';
      tasks = [];
      goalResults = [];
      reviewFeedback = `review report is invalid: ${err?.message ?? err}`;
      failure = classifyRubricFailure(err?.code);
    }
  }

  // Goal Eval 坏了就无法确认「必需条件都过了」：PASS 一律降级为 FAIL，并清空
  // 无法核对的逐条件证据（不臆造、也不复用不可信 id）。
  if (goalEvalError) {
    failure = failure ?? 'goal_eval_invalid';
    goalResults = [];
    if (verdict === 'PASS') verdict = 'FAIL';
    reviewFeedback = [reviewFeedback, goalEvalError].filter(Boolean).join(' | ');
  }

  // 终态 PASS 却没有可读的 review 报告 = 没有证据的 PASS（不是失败分类，绝不宣称已验证）。
  if (!reviewText && verdict === 'PASS' && isTerminalState(state)) {
    failure = failure ?? 'review_missing';
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
    revision,
    verdict,
    // 任何不可信分类（review 不可解析 / 缺少证据 / eval 坏了）都不算「结果就绪」。
    resultReady: !failure && isTerminalState(state) && !!(reviewText || receiptText || artifactRefs.size > 0),
    goalAcceptance,
    goalConditions: goalEval ? goalEval.conditions : [],
    goalResults,
    goalEvalValid: !!goalEval,
    failure,
    tasks,
    reviewFeedback,
    receipt,
    artifacts: Array.from(artifactRefs),
  };
}
