// Review 结构化 rubric（docs/superpowers/plans/2026-10-31-review-rubric.md）：
// review 必须逐任务给出 pass/fail/skipped + 证据；缺失或被判官自我矛盾的 rubric 一律拒绝。
// 纯函数，无 fs / 无状态。

export type ReviewTaskResult = {
  taskId: string;
  result: 'pass' | 'fail' | 'skipped';
  evidence: string;
};

export type ReviewRubric = {
  verdict: 'PASS' | 'FAIL';
  tasks: ReviewTaskResult[];
  feedback: string;
  /** true = 输入自相矛盾（有 fail 却给 PASS），已降级为 FAIL。 */
  inconsistent?: boolean;
};

export type RubricErrorCode = 'missing_tasks' | 'invalid';

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

export function parseReviewRubric(markdown: string, taskIds: string[]): ReviewRubric {
  const payload = extractPayload(markdown);
  if (!payload || typeof payload !== 'object') {
    throw new RubricError('invalid', 'mafw-review payload must be an object');
  }
  const verdict = payload.verdict === 'PASS' ? 'PASS' : payload.verdict === 'FAIL' ? 'FAIL' : null;
  if (!verdict) throw new RubricError('invalid', 'mafw-review payload missing verdict');

  const feedback = String(payload.feedback ?? payload.reason ?? '');
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : null;
  const expected = Array.from(new Set(taskIds.filter((id) => typeof id === 'string' && id.length > 0)));

  if (!rawTasks) {
    if (expected.length > 0) {
      throw new RubricError(
        'missing_tasks',
        `review rubric must list every wave task; missing: ${expected.join(', ')}`,
      );
    }
    return { verdict, tasks: [], feedback };
  }

  const tasks: ReviewTaskResult[] = [];
  const seen = new Set<string>();
  for (const item of rawTasks) {
    const taskId = String(item?.taskId ?? '').trim();
    if (!taskId) throw new RubricError('invalid', 'rubric task entry missing taskId');
    if (seen.has(taskId)) throw new RubricError('invalid', `duplicate rubric taskId: ${taskId}`);
    const result = normalizeResult(item?.result);
    if (!result) throw new RubricError('invalid', `rubric task ${taskId} has invalid result`);
    seen.add(taskId);
    tasks.push({ taskId, result, evidence: String(item?.evidence ?? '').trim() });
  }

  const missing = expected.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new RubricError(
      'missing_tasks',
      `review rubric must list every wave task; missing: ${missing.join(', ')}`,
    );
  }

  const failed = tasks.filter((task) => task.result === 'fail').map((task) => task.taskId);
  if (verdict === 'PASS' && failed.length > 0) {
    return {
      verdict: 'FAIL',
      tasks,
      inconsistent: true,
      feedback: [
        feedback,
        `rubric inconsistent: ${failed.join(', ')} marked fail but verdict was PASS`,
      ].filter(Boolean).join(' | '),
    };
  }

  return { verdict, tasks, feedback };
}
