// Review 结构化 rubric（docs/superpowers/plans/2026-10-31-review-rubric.md）：
// review 必须逐任务给出 pass/fail/skipped + 证据；缺失或被判官自我矛盾的 rubric 一律拒绝。
// 纯函数，无 fs / 无状态。

export type ReviewTaskResult = {
  taskId: string;
  result: 'pass' | 'fail' | 'skipped';
  evidence: string;
};

/** Goal 级验收条件的逐条判定（spec §7.2：任务全绿不能推导 Goal PASS）。 */
export type ReviewGoalResult = {
  conditionId: string;
  result: 'pass' | 'fail' | 'skipped';
  evidence: string;
};

export type ReviewRubric = {
  verdict: 'PASS' | 'FAIL';
  tasks: ReviewTaskResult[];
  /** Goal 条件判定；无 required 条件时为空数组（旧评审文件兼容）。 */
  goalResults: ReviewGoalResult[];
  feedback: string;
  /** true = 输入自相矛盾（有 fail 却给 PASS），已降级为 FAIL。 */
  inconsistent?: boolean;
};

export type RubricErrorCode = 'missing_tasks' | 'invalid' | 'missing_goal_conditions';

export class RubricError extends Error {
  readonly code: RubricErrorCode;

  constructor(code: RubricErrorCode, message: string) {
    super(message);
    this.name = 'RubricError';
    this.code = code;
  }
}

const FENCED_BLOCK_RE = /```mafw-review\s*\n([\s\S]*?)```/;

function extractPayload(markdown: string): any {
  const fenced = markdown.match(FENCED_BLOCK_RE);
  const raw = fenced ? fenced[1].trim() : markdown.trim();
  if (!raw) throw new RubricError('invalid', 'review report is empty');
  try {
    return JSON.parse(raw);
  } catch {
    throw new RubricError('invalid', 'review report has no machine-readable mafw-review JSON block');
  }
}

function normalizeResult(value: unknown): ReviewTaskResult['result'] | null {
  return value === 'pass' || value === 'fail' || value === 'skipped' ? value : null;
}

import { taskIdAt } from './wave-plan-edit';

/** waves.json 的 taskId 序列（稳定 `taskId` 优先，legacy 回退 `${wave.id}-t${i+1}`）。
 *  任务既可以是字符串，也可以是 `{title, acceptance?}`。 */
export function taskIdsFromWavePlan(plan: unknown): string[] {
  const waves = plan && typeof plan === 'object' ? (plan as any).waves : null;
  if (!Array.isArray(waves)) return [];
  const ids: string[] = [];
  for (const wave of waves) {
    if (typeof wave?.id !== 'string' || !wave.id) continue;
    const tasks = Array.isArray(wave?.tasks) ? wave.tasks : [];
    tasks.forEach((task: unknown, index: number) => {
      const id = taskIdAt(wave, task, index);
      if (id) ids.push(id);
    });
  }
  return ids;
}

/** 从 waves 计划提取「taskId → acceptance[]」（对象形任务才有）。 */
export function taskAcceptanceFromWavePlan(plan: unknown): Record<string, string[]> {
  const waves = plan && typeof plan === 'object' ? (plan as any).waves : null;
  if (!Array.isArray(waves)) return {};
  const out: Record<string, string[]> = {};
  for (const wave of waves) {
    if (typeof wave?.id !== 'string' || !wave.id) continue;
    const tasks = Array.isArray(wave?.tasks) ? wave.tasks : [];
    tasks.forEach((task: any, index: number) => {
      if (!task || typeof task === 'string') return;
      const acceptance = Array.isArray(task.acceptance)
        ? task.acceptance.map((item: unknown) => String(item).trim()).filter(Boolean)
        : [];
      const id = taskIdAt(wave, task, index);
      if (acceptance.length > 0 && id) out[id] = acceptance;
    });
  }
  return out;
}

/** waves 里一个任务的标题（兼容字符串/对象两种形态）。 */
export function waveTaskTitle(task: unknown): string {
  if (typeof task === 'string') return task;
  if (task && typeof task === 'object' && typeof (task as any).title === 'string') return (task as any).title;
  return '';
}

export function parseReviewRubric(
  markdown: string,
  taskIds: string[],
  requiredGoalConditionIds: string[] = [],
): ReviewRubric {
  const payload = extractPayload(markdown);
  if (!payload || typeof payload !== 'object') {
    throw new RubricError('invalid', 'mafw-review payload must be an object');
  }
  const verdict = payload.verdict === 'PASS' ? 'PASS' : payload.verdict === 'FAIL' ? 'FAIL' : null;
  if (!verdict) throw new RubricError('invalid', 'mafw-review payload missing verdict');

  const feedback = String(payload.feedback ?? payload.reason ?? '');
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : null;
  const expected = uniqueIds(taskIds);

  if (!rawTasks && expected.length > 0) {
    throw new RubricError(
      'missing_tasks',
      `review rubric must list every wave task; missing: ${expected.join(', ')}`,
    );
  }

  const tasks: ReviewTaskResult[] = [];
  const seen = new Set<string>();
  for (const item of rawTasks ?? []) {
    const taskId = String(item?.taskId ?? '').trim();
    if (!taskId) throw new RubricError('invalid', 'rubric task entry missing taskId');
    if (seen.has(taskId)) throw new RubricError('invalid', `duplicate rubric taskId: ${taskId}`);
    const result = normalizeResult(item?.result);
    if (!result) throw new RubricError('invalid', `rubric task ${taskId} has invalid result`);
    const evidence = String(item?.evidence ?? '').trim();
    if (result !== 'skipped' && !evidence) {
      throw new RubricError('invalid', `rubric task ${taskId} is missing verifiable evidence`);
    }
    seen.add(taskId);
    tasks.push({ taskId, result, evidence });
  }

  const missing = expected.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new RubricError(
      'missing_tasks',
      `review rubric must list every wave task; missing: ${missing.join(', ')}`,
    );
  }

  const requiredGoals = uniqueIds(requiredGoalConditionIds);
  const goalResults = parseGoalResults(payload.goalResults, requiredGoals);

  // spec §7.2：任一必需 Goal 条件失败或缺证据，Goal 不得 PASS。任务级矛盾降级为 FAIL
  // （保留既有语义），Goal 级矛盾则说明评审本身不可信 → invalid（artifact_invalid）。
  const blockingGoals = goalResults
    .filter((goal) => requiredGoals.includes(goal.conditionId) && goal.result !== 'pass')
    .map((goal) => `${goal.conditionId} ${goal.result}`);
  if (verdict === 'PASS' && blockingGoals.length > 0) {
    throw new RubricError(
      'invalid',
      `rubric inconsistent: required goal conditions not passing (${blockingGoals.join(', ')}) but verdict was PASS`,
    );
  }

  const failed = tasks.filter((task) => task.result === 'fail').map((task) => task.taskId);
  if (verdict === 'PASS' && failed.length > 0) {
    return {
      verdict: 'FAIL',
      tasks,
      goalResults,
      inconsistent: true,
      feedback: [
        feedback,
        `rubric inconsistent: ${failed.join(', ')} marked fail but verdict was PASS`,
      ].filter(Boolean).join(' | '),
    };
  }

  return { verdict, tasks, goalResults, feedback };
}

function uniqueIds(ids: readonly unknown[]): string[] {
  const cleaned = ids
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
  return Array.from(new Set(cleaned));
}

/** 逐条解析 Goal 条件判定：必需条件必须恰好覆盖一次、evidence 非空、result 合法。 */
function parseGoalResults(raw: unknown, requiredIds: string[]): ReviewGoalResult[] {
  const missingMessage = () =>
    `review rubric must list every required goal condition; missing: ${requiredIds.join(', ')}`;

  if (raw === undefined || raw === null) {
    if (requiredIds.length > 0) throw new RubricError('missing_goal_conditions', missingMessage());
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new RubricError('invalid', 'mafw-review goalResults must be an array');
  }

  const results: ReviewGoalResult[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new RubricError('invalid', 'goal result entry must be an object');
    }
    const conditionId = String((item as any).conditionId ?? '').trim();
    if (!conditionId) throw new RubricError('invalid', 'goal result entry missing conditionId');
    if (seen.has(conditionId)) {
      throw new RubricError('invalid', `duplicate goal condition id: ${conditionId}`);
    }
    const result = normalizeResult((item as any).result);
    if (!result) {
      throw new RubricError('invalid', `goal condition ${conditionId} has invalid result`);
    }
    const evidence = String((item as any).evidence ?? '').trim();
    if (!evidence) {
      throw new RubricError('invalid', `goal condition ${conditionId} is missing verifiable evidence`);
    }
    seen.add(conditionId);
    results.push({ conditionId, result, evidence });
  }

  const missing = requiredIds.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new RubricError('missing_goal_conditions', missingMessage());

  return results;
}
