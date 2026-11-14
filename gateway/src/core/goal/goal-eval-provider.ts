// GoalEval provider seam.
//
// A provider evaluates the PlanPackage's Goal conditions after the reviewer has
// produced task results. It never decides the overall verdict alone: the core
// validates coverage/evidence and forces FAIL whenever a required condition is
// missing, skipped or failed. Human acceptance remains outside this module.
import type { GoalEval } from './goal-eval';
import type {
  ReviewGoalResult,
  ReviewRubric,
  ReviewTaskResult,
} from './review-rubric';

export interface GoalEvalProviderInput {
  goalEval: GoalEval;
  plan: unknown;
  taskResults: ReviewTaskResult[];
  reviewFeedback?: string;
}

export type GoalEvalConditionResult = ReviewGoalResult;

export interface GoalEvalProvider {
  id: string;
  /** replace = authoritative; advisory = only provider failures override reviewer. */
  mode?: 'replace' | 'advisory';
  evaluate(input: GoalEvalProviderInput): Promise<GoalEvalConditionResult[]> | GoalEvalConditionResult[];
  health?(): 'healthy' | 'degraded' | 'failed';
  dispose?(): void;
}

export interface GoalEvalApplyResult {
  ok: boolean;
  verdict: ReviewRubric;
  errors: string[];
}

const GOAL_OMISSION_RE = /goal condition|required goal/i;

/**
 * Replace the reviewer's Goal-condition results with provider results.
 *
 * Structural errors (unknown/duplicate ids, invalid result values) return
 * `ok:false` and leave the reviewer verdict untouched. Coverage/evidence gaps
 * are not structural errors: they force FAIL and add omissions.
 */
export function applyGoalEvalResults(
  verdict: ReviewRubric,
  goalEval: GoalEval,
  results: GoalEvalConditionResult[],
  requiredIds: string[],
  mode: 'replace' | 'advisory' = 'replace',
): GoalEvalApplyResult {
  const errors: string[] = [];
  if (!Array.isArray(results)) {
    return { ok: false, verdict, errors: ['goal eval results must be an array'] };
  }

  const known = new Set(goalEval.conditions.map((condition) => condition.id));
  const seen = new Set<string>();
  const omissions: string[] = [];
  const normalized: ReviewGoalResult[] = [];

  for (const raw of results as unknown[]) {
    const item = raw as Partial<ReviewGoalResult>;
    const conditionId = typeof item?.conditionId === 'string' ? item.conditionId : '';
    if (!conditionId || !known.has(conditionId)) {
      errors.push(`unknown goal condition: ${conditionId || '(empty)'}`);
      continue;
    }
    if (seen.has(conditionId)) {
      errors.push(`duplicate goal condition: ${conditionId}`);
      continue;
    }
    seen.add(conditionId);

    const result = item.result;
    if (result !== 'pass' && result !== 'fail' && result !== 'skipped') {
      errors.push(`goal condition ${conditionId} has invalid result`);
      continue;
    }

    let evidence = typeof item.evidence === 'string' ? item.evidence.trim() : '';
    let normalizedResult = result;
    // Advisory providers only act on failures; pass/skipped are abstentions.
    if (mode === 'replace' && result !== 'skipped' && !evidence) {
      omissions.push(`goal condition ${conditionId} is missing verifiable evidence`);
      normalizedResult = 'fail';
      evidence = 'missing verifiable evidence';
    }
    normalized.push({ conditionId, result: normalizedResult, evidence });
  }

  if (errors.length > 0) {
    return { ok: false, verdict, errors };
  }

  let merged: ReviewGoalResult[];
  if (mode === 'advisory') {
    const byId = new Map(verdict.goalResults.map((item) => [item.conditionId, item]));
    for (const item of normalized) {
      if (item.result !== 'fail') continue;
      byId.set(item.conditionId, {
        conditionId: item.conditionId,
        result: 'fail',
        evidence: item.evidence || 'provider reported fail',
      });
    }
    merged = [...byId.values()];
  } else {
    merged = normalized;
  }

  const byId = new Map(merged.map((item) => [item.conditionId, item]));
  const missingRequired = requiredIds.filter((id) => !byId.has(id));
  const blocking = requiredIds.filter((id) => byId.get(id)?.result !== 'pass');

  if (missingRequired.length > 0) {
    omissions.push(`missing required goal condition: ${missingRequired.join(', ')}`);
  }
  if (blocking.length > 0) {
    omissions.push(`rubric inconsistent: required goal conditions not passing (${blocking.join(', ')})`);
  }

  const keptOmissions = (verdict.omissions ?? []).filter((item) => !GOAL_OMISSION_RE.test(item));
  const next: ReviewRubric = {
    ...verdict,
    goalResults: merged,
    missingGoalConditions: missingRequired,
    omissions: [...keptOmissions, ...omissions],
  };

  const mustFail = missingRequired.length > 0 || blocking.length > 0;
  if (mustFail) {
    if (next.verdict === 'PASS') next.inconsistent = true;
    next.verdict = 'FAIL';
  }

  return { ok: true, verdict: next, errors: [] };
}
