// Review 结构化 rubric（docs/superpowers/plans/2026-10-31-review-rubric.md）：
// review 必须逐任务给出 pass/fail/skipped + 证据；缺失或被判官自我矛盾的 rubric 一律拒绝。
// 纯函数，无 fs / 无状态。
//
// 失败语义（2026-11-03 修正，spec §7.2）：
// - **产物不可解析 / 结构非法**（没有 JSON、不是对象、缺 verdict、result 非法、id 重复）→
//   `RubricError`（driver 记 artifact_invalid，终态契约错误）。
// - **评审内容不完整**（任务/条件缺证据、漏任务、漏必需 Goal 条件、必需条件未通过）→
//   不是坏产物，而是**评审判定 FAIL**：进入既有 reviewFix / round 语义（会重试），
//   绝不把整个 Goal 打成 artifact_invalid。缺证据的 pass 一律降级为 fail。

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
  /**
   * 评审内容缺口（缺证据 / 漏任务 / 漏必需条件）。非空即强制 FAIL：
   * 这些缺口走失败复核或下一轮，而不是 artifact_invalid。
   */
  omissions?: string[];
  /** 未覆盖的必需 Goal 条件 id（结果页据此区分「条件缺失」与「报告损坏」）。 */
  missingGoalConditions?: string[];
};

export type RubricErrorCode = 'missing_tasks' | 'invalid' | 'missing_goal_conditions';
// 说明：只有 `invalid`（结构/JSON 非法）还会抛出；`missing_tasks` / `missing_goal_conditions`
// 是历史码（现在走 `ReviewRubric.omissions`），保留在联合类型里给下游分类器兼容。

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

const MISSING_EVIDENCE = 'missing verifiable evidence';

export function parseReviewRubric(
  markdown: string,
  taskIds: string[],
  requiredGoalConditionIds: string[] = [],
): ReviewRubric {
  const payload = extractPayload(markdown);
  if (!payload || typeof payload !== 'object') {
    throw new RubricError('invalid', 'mafw-review payload must be an object');
  }
  const rawVerdict = payload.verdict === 'PASS' ? 'PASS' : payload.verdict === 'FAIL' ? 'FAIL' : null;
  if (!rawVerdict) throw new RubricError('invalid', 'mafw-review payload missing verdict');

  const feedback = String(payload.feedback ?? payload.reason ?? '');
  const omissions: string[] = [];

  // 结构非法（类型错）仍是坏产物；内容缺失（漏条目 / 缺证据）是评审不完整。
  if (payload.tasks !== undefined && payload.tasks !== null && !Array.isArray(payload.tasks)) {
    throw new RubricError('invalid', 'mafw-review tasks must be an array');
  }
  const rawTasks: any[] | null = Array.isArray(payload.tasks) ? payload.tasks : null;
  const expected = uniqueIds(taskIds);
  if (!rawTasks && expected.length > 0) {
    omissions.push(`review rubric must list every wave task; missing: ${expected.join(', ')}`);
  }

  const tasks: ReviewTaskResult[] = [];
  const seen = new Set<string>();
  for (const item of rawTasks ?? []) {
    const taskId = String(item?.taskId ?? '').trim();
    if (!taskId) throw new RubricError('invalid', 'rubric task entry missing taskId');
    if (seen.has(taskId)) throw new RubricError('invalid', `duplicate rubric taskId: ${taskId}`);
    const parsed = normalizeResult(item?.result);
    if (!parsed) throw new RubricError('invalid', `rubric task ${taskId} has invalid result`);
    let result = parsed;
    let evidence = String(item?.evidence ?? '').trim();
    if (result !== 'skipped' && !evidence) {
      // 没有证据就不可能是 pass：降级为 fail，交给修复/下一轮补证据。
      omissions.push(`rubric task ${taskId} is missing verifiable evidence`);
      if (result === 'pass') result = 'fail';
      evidence = MISSING_EVIDENCE;
    }
    seen.add(taskId);
    tasks.push({ taskId, result, evidence });
  }

  const missingTasks = expected.filter((id) => !seen.has(id));
  if (rawTasks && missingTasks.length > 0) {
    omissions.push(`review rubric must list every wave task; missing: ${missingTasks.join(', ')}`);
  }

  const requiredGoals = uniqueIds(requiredGoalConditionIds);
  const goals = parseGoalResults(payload.goalResults, requiredGoals, omissions);
  const goalResults = goals.results;

  // spec §7.2：任一必需 Goal 条件失败或缺证据，Goal 不得 PASS。
  const blockingGoals = goalResults
    .filter((goal) => requiredGoals.includes(goal.conditionId) && goal.result !== 'pass')
    .map((goal) => `${goal.conditionId} ${goal.result}`);
  if (rawVerdict === 'PASS' && blockingGoals.length > 0) {
    omissions.push(
      `rubric inconsistent: required goal conditions not passing (${blockingGoals.join(', ')}) but verdict was PASS`,
    );
  }

  const failed = tasks.filter((task) => task.result === 'fail').map((task) => task.taskId);
  let inconsistent = false;
  if (rawVerdict === 'PASS' && failed.length > 0) {
    inconsistent = true;
    omissions.push(`rubric inconsistent: ${failed.join(', ')} marked fail but verdict was PASS`);
  }

  const verdict: 'PASS' | 'FAIL' = rawVerdict === 'PASS' && omissions.length > 0 ? 'FAIL' : rawVerdict;
  const mergedFeedback = [feedback, ...omissions].filter(Boolean).join(' | ');

  return {
    verdict,
    tasks,
    goalResults,
    feedback: mergedFeedback,
    ...(inconsistent ? { inconsistent: true } : {}),
    ...(omissions.length > 0 ? { omissions } : {}),
    ...(goals.missing.length > 0 ? { missingGoalConditions: goals.missing } : {}),
  };
}

function uniqueIds(ids: readonly unknown[]): string[] {
  const cleaned = ids
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
  return Array.from(new Set(cleaned));
}

/**
 * 逐条解析 Goal 条件判定：必需条件必须恰好覆盖一次、evidence 非空、result 合法。
 * 结构非法抛 RubricError；缺条目 / 缺证据记入 `omissions`（→ 评审 FAIL，不升级）。
 */
function parseGoalResults(
  raw: unknown,
  requiredIds: string[],
  omissions: string[],
): { results: ReviewGoalResult[]; missing: string[] } {
  const missingMessage = () =>
    `review rubric must list every required goal condition; missing: ${requiredIds.join(', ')}`;

  if (raw === undefined || raw === null) {
    if (requiredIds.length > 0) {
      omissions.push(missingMessage());
      return { results: [], missing: requiredIds };
    }
    return { results: [], missing: [] };
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
    const parsed = normalizeResult((item as any).result);
    if (!parsed) {
      throw new RubricError('invalid', `goal condition ${conditionId} has invalid result`);
    }
    let result = parsed;
    let evidence = String((item as any).evidence ?? '').trim();
    if (!evidence) {
      omissions.push(`goal condition ${conditionId} is missing verifiable evidence`);
      if (result === 'pass') result = 'fail';
      evidence = MISSING_EVIDENCE;
    }
    seen.add(conditionId);
    results.push({ conditionId, result, evidence });
  }

  const missing = requiredIds.filter((id) => !seen.has(id));
  if (missing.length > 0) omissions.push(missingMessage());

  return { results, missing };
}
