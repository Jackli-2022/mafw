// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as fs from 'fs';
import * as path from 'path';
import type { OutputSchemaSpec } from '../../runtime/structured-output';
import type { FailureClass } from './failure-class';
import type { GoalEval, GoalEvalCondition } from './goal-eval';
import { validateGoalEval } from './goal-eval';

const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'research', 'docs', 'test', 'other'] as const;

/** Goal Eval（spec §7.1）：Plan 的第二条腿，和 waves 同属一个 PlanPackage。 */
const GOAL_EVAL_SCHEMA = {
  type: 'object',
  required: ['outcome', 'conditions'],
  properties: {
    outcome: { type: 'string' },
    conditions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'statement', 'required', 'evidence', 'method'],
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          required: { type: 'boolean' },
          evidence: { type: 'string' },
          method: { type: 'string' },
        },
      },
    },
    failureConditions: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    mapping: { type: 'object' },
  },
} as const;

const PLAN_OUTPUT_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      required: ['status', 'taskType', 'waves', 'goalEval'],
      properties: {
        status: { const: 'ready' },
        taskType: { type: 'string', enum: [...TASK_TYPES] },
        goalEval: GOAL_EVAL_SCHEMA,
        waves: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'title', 'tasks', 'riskNote'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              tasks: {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      required: ['title'],
                      properties: {
                        title: { type: 'string' },
                        acceptance: {
                          type: 'array',
                          maxItems: 20,
                          items: { type: 'string', maxLength: 500 },
                        },
                        taskId: { type: 'string' },
                      },
                    },
                  ],
                },
              },
              riskNote: { type: 'string' },
            },
          },
        },
      },
    },
    {
      type: 'object',
      required: ['status', 'ambiguities'],
      properties: {
        status: { const: 'need_clarification' },
        ambiguities: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
    },
  ],
} as const;

export function planOutputSchema(): Record<string, unknown> {
  return PLAN_OUTPUT_SCHEMA as unknown as Record<string, unknown>;
}

const EXECUTE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['goalId', 'receipts'],
  properties: {
    goalId: { type: 'string' },
    timestamp: { type: 'string' },
    receipts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'status', 'summary'],
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string', enum: ['done', 'failed', 'skipped'] },
          summary: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'tasks', 'feedback'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'result', 'evidence'],
        properties: {
          taskId: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
          evidence: { type: 'string' },
        },
      },
    },
    // Goal 级验收条件（spec §7.2）：可选字段保持旧评审文件兼容；解析器按 required 条件强制覆盖。
    goalResults: {
      type: 'array',
      items: {
        type: 'object',
        required: ['conditionId', 'result', 'evidence'],
        properties: {
          conditionId: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
          evidence: { type: 'string' },
        },
      },
    },
    feedback: { type: 'string' },
  },
} as const;

/** Goal 节点结构化交卷 schema（与文件产物同字段；structured 优先、文件 fallback）。 */
export function nodeOutputSchema(node: 'plan' | 'execute' | 'review'): OutputSchemaSpec {
  if (node === 'plan') return { name: 'goal.plan', schema: PLAN_OUTPUT_SCHEMA as unknown as Record<string, any> };
  if (node === 'execute') return { name: 'goal.execute', schema: EXECUTE_OUTPUT_SCHEMA as unknown as Record<string, any> };
  return { name: 'goal.review', schema: REVIEW_OUTPUT_SCHEMA as unknown as Record<string, any> };
}

export interface NodeArtifactPaths {
  waves: string;
  receipt: string; // per-loop，不覆盖
  review: string;
}

/** revision 归一（缺省/非法 → 1，与 state-v3 的 effectiveRevision 同语义）。 */
export function normalizeArtifactRevision(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * 产物根目录：revision 1 沿用旧布局（`<mafw>/waves.json` 等，legacy 零迁移）；
 * revision ≥ 2 完全隔离在 `<mafw>/revisions/<goalId>/rev-<n>/` 下——同一 Goal
 * 的每个 revision 拥有独立的 Plan / Receipt / Review，互不覆盖。
 */
export function goalArtifactRoot(mafwDir: string, goalId: string, revision?: number): string {
  const rev = normalizeArtifactRevision(revision);
  return rev <= 1 ? mafwDir : path.join(mafwDir, 'revisions', goalId, `rev-${rev}`);
}

export function nodeArtifactPaths(
  mafwDir: string,
  goalId: string,
  round: number,
  opts: { fix?: boolean; revision?: number } = {},
): NodeArtifactPaths {
  const suffix = opts.fix ? '-fix' : '';
  const rev = normalizeArtifactRevision(opts.revision);
  if (rev <= 1) {
    return {
      waves: path.join(mafwDir, 'waves.json'),
      receipt: path.join(mafwDir, 'receipts', goalId, `loop-${round}${suffix}-receipt.json`),
      review: path.join(mafwDir, 'reviews', `${goalId}-loop${round}${suffix}.md`),
    };
  }
  const base = goalArtifactRoot(mafwDir, goalId, rev);
  return {
    waves: path.join(base, 'waves.json'),
    receipt: path.join(base, 'receipts', `loop-${round}${suffix}-receipt.json`),
    review: path.join(base, 'reviews', `loop${round}${suffix}.md`),
  };
}

/**
 * Goal Eval 产物路径（PlanPackage 的第二条腿，与 waves 同一 revision）：
 * - revision 1：`<mafw>/goals/<goalId>/goal-eval.json`（goal-dir 工作区约定，
 *   与 `pod-result.goalEvalPathFor` / ContextManifest 的清单一致）；
 * - revision ≥ 2：`<mafw>/revisions/<goalId>/rev-<n>/goal-eval.json`（与 waves 同目录，
 *   每个 revision 的评估契约互不覆盖）。
 */
export function goalEvalArtifactPath(mafwDir: string, goalId: string, revision?: number): string {
  const rev = normalizeArtifactRevision(revision);
  if (rev > 1) return path.join(goalArtifactRoot(mafwDir, goalId, rev), 'goal-eval.json');
  // goalId 直接成为目录名：拒绝 `..`/分隔符，标点折叠为 `_`。
  const cleaned = String(goalId ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  const safe = /[A-Za-z0-9]/.test(cleaned) ? cleaned : '_';
  return path.join(mafwDir, 'goals', safe, 'goal-eval.json');
}

export interface GoalEvalArtifactRead {
  /** 合法且已规范化的 Goal Eval；缺失或非法时为 null。 */
  goalEval: GoalEval | null;
  /** 产物存在但不可解析/不合法时的原因（消费方据此 fail closed，绝不静默当没有）。 */
  error: string | null;
  /** 权威路径（GET /plan 展示与排错用）。 */
  path: string;
}

/**
 * 读取某个 revision 的 Goal Eval：**旁文件优先**（评审/结果页读的就是它），
 * 文件不存在时回退到 waves 产物里内嵌的 `goalEval`（计划刚交卷、driver 还没落盘时）。
 * 存在但非法一律返回 error——绝不退化成"没有 eval"（否则必需条件门会被静默绕过）。
 */
export function readGoalEvalArtifact(
  mafwDir: string,
  goalId: string,
  revision?: number,
  planDoc?: unknown,
): GoalEvalArtifactRead {
  const target = goalEvalArtifactPath(mafwDir, goalId, revision);
  let raw: unknown;
  let present = false;
  if (fs.existsSync(target)) {
    present = true;
    try {
      raw = JSON.parse(fs.readFileSync(target, 'utf-8'));
    } catch {
      return { goalEval: null, error: `goal eval is not valid JSON: ${target}`, path: target };
    }
  } else if (planDoc && typeof planDoc === 'object' && (planDoc as any).goalEval !== undefined) {
    present = true;
    raw = (planDoc as any).goalEval;
  }
  if (!present) return { goalEval: null, error: null, path: target };
  try {
    return { goalEval: validateGoalEval(raw), error: null, path: target };
  } catch (err: any) {
    return { goalEval: null, error: `goal eval is invalid: ${err?.message ?? err}`, path: target };
  }
}

export interface NodePromptCtx {
  goalId: string;
  projectDir: string;
  mafwDir: string;
  round: number;
  maxRounds: number;
  /** Goal revision（缺省 1）：产物路径与 prompt 头部据此隔离。 */
  revision?: number;
  charterPath: string;
  requestPath: string;
  reviewFeedback?: string;
  /** W1：上一版计划的驳回反馈（plan 重规划时注入；plan 成功兑现时由 driver 清除）。 */
  planFeedback?: string;
  /** W4：能力账本 + 失败谱块（仅 plan 节点注入，规划时主动规避反复失败）。 */
  priorBlock?: string;
  /** D4b：反事实推演块（仅 plan 节点注入，pre-mortem）。 */
  counterfactualBlock?: string;
  /** 同轮复核：失败任务 + reviewer 证据（execute 修复模式注入）。 */
  fixTasks?: Array<{ taskId: string; evidence: string }>;
  /** 同轮复核：上一轮完整回执路径（修复模式要在此基础上保留已通过项）。 */
  fixPreviousReceipt?: string;
  /** 任务验收标准（review 节点按它判定；缺省则该任务自证）。 */
  acceptance?: Record<string, string[]>;
  /** Goal 级验收条件（review 节点必须逐条判定，task 全绿不能代替）。 */
  goalConditions?: GoalEvalCondition[];
  /** Goal 级期望结果（request.acceptance）；plan 必须分解到 wave task acceptance。 */
  goalAcceptance?: string[];
  /** Goal 级边界（request.boundaries）；plan 不能越界。 */
  goalBoundaries?: string[];
  /** 创建时声明的任务类型（plan 判断可修正，waves.taskType 为准）。 */
  goalTaskType?: string;
  /** 计划审阅模式（manual = 人工批准后才实施）。 */
  planReview?: 'auto' | 'manual';
  attempt?: number;
  maxAttempts?: number;
  lastFailure?: {
    class: FailureClass;
    code: string;
    message: string;
    node: 'plan' | 'execute' | 'review';
    attempt: number;
    at: string;
  } | null;
  userAnswer?: string;
  userQuestions?: string[];
}

export function renderNodePrompt(node: 'plan' | 'execute' | 'review', ctx: NodePromptCtx): string {
  const isFixPass = node === 'execute' && !!ctx.fixTasks?.length;
  const revision = normalizeArtifactRevision(ctx.revision);
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round, { fix: isFixPass, revision });
  // revision 1 保持旧头部（legacy prompt 断言零迁移）；更高 revision 显式标注，
  // 让模型知道自己在第几版目标下工作、产物落在隔离目录。
  const head = revision > 1
    ? `【MAFW Goal ${ctx.goalId} · rev ${revision} · loop ${ctx.round}/${ctx.maxRounds}】`
    : `【MAFW Goal ${ctx.goalId} · loop ${ctx.round}/${ctx.maxRounds}】`;
  const docs = `charter: ${ctx.charterPath}\nrequest: ${ctx.requestPath}`;
  const retryContext = [
    ctx.attempt && ctx.maxAttempts ? `Retry context: attempt ${ctx.attempt}/${ctx.maxAttempts}.` : '',
    ctx.lastFailure
      ? `Last failure [${ctx.lastFailure.class}/${ctx.lastFailure.code}]: ${ctx.lastFailure.message}. Inspect existing artifacts/worktree before repeating work; do not assume prior side effects were rolled back.`
      : '',
    ctx.userAnswer
      ? `User answer to the previous question${ctx.userQuestions?.length ? ` (${ctx.userQuestions.join(' | ')})` : ''}: ${ctx.userAnswer}`
      : '',
  ].filter(Boolean).join('\n');

  if (node === 'plan') {
    return [
      head, docs, retryContext, '',
      ctx.goalAcceptance?.length
        ? `Goal acceptance（必须在 wave task acceptance 中 decompose，不能只复述）：\n${ctx.goalAcceptance.map((item) => `- ${item}`).join('\n')}`
        : '',
      ctx.goalBoundaries?.length
        ? `Goal boundaries（不得越界）：\n${ctx.goalBoundaries.map((item) => `- ${item}`).join('\n')}`
        : '',
      ctx.goalTaskType
        ? `Declared task type: ${ctx.goalTaskType}（可修正，最终以 waves.taskType 为准）`
        : '',
      ctx.planReview
        ? `Plan review mode: ${ctx.planReview === 'manual' ? 'manual（计划需人工批准后才实施）' : 'auto'}`
        : '',
      ctx.priorBlock || '',
      ctx.counterfactualBlock || '',
      ctx.planFeedback
        ? `上一版计划被驳回，用户意见（本轮计划必须消化）：\n${ctx.planFeedback}` : '',
      `任务：阅读 charter 与仓库现状，产出 wave 执行计划 + Goal Eval，写入 ${a.waves}。`,
      ctx.round > 1 && ctx.reviewFeedback
        ? `上一轮 review 指出的问题（本轮计划必须消化）：\n${ctx.reviewFeedback}` : '',
      '',
      `产物契约（必须是合法 JSON，写入 ${a.waves}）：`,
      '{"taskType":"feature|bugfix|refactor|research|docs|test|other","waves":[{"id":"w1","title":"...","tasks":[{"title":"...","acceptance":["可验证标准 1","可验证标准 2"]}],"riskNote":"此 wave 最可能的失败 + 对应缓解"}],"goalEval":{"outcome":"...","conditions":[{"id":"g1","statement":"...","required":true,"evidence":"证据形态","method":"怎么验"}],"failureConditions":["..."],"constraints":["..."],"nonGoals":["..."],"mapping":{"g1":{"tasks":["w1-t1"],"probes":[],"artifacts":["路径"]}}},"status":"ready"}',
      `Goal Eval 回答"怎样证明做对了"，和 waves 同属一份计划产物（driver 会把它写到 ${goalEvalArtifactPath(ctx.mafwDir, ctx.goalId, revision)}，评审按它判定）。`,
      '至少一条 required 条件；每条条件必须有 evidence 与 method；mapping 只能引用真实条件 id，任务只能映射到本计划里存在的 taskId。',
      '每个任务尽量给 `acceptance`（2–4 条、可机械验证，如"npm test -- pod 全绿"、"receipts 含 artifact 路径"）；',
      '字符串形式的任务也接受，但没有 acceptance 时 review 只能自证。',
      '顶层 taskType 与每 wave 的 riskNote 为 D4b 反事实要求（判断任务类型；对照历史失败模式为每个 wave 预设缓解）。',
      '若存在无法自行消除的歧义：{"status":"need_clarification","ambiguities":["问题..."]}',
    ].filter(Boolean).join('\n');
  }

  if (node === 'execute') {
    if (isFixPass) {
      const failed = (ctx.fixTasks ?? []).map((task) => `- ${task.taskId}：${task.evidence || "（reviewer 未给证据）"}`).join('\n');
      return [
        head, docs, retryContext, '',
        `任务：**同轮复核修复**。上一轮 review 判定以下任务未通过，只修这些，不要扩大范围：`,
        failed,
        ctx.reviewFeedback ? `reviewer 总结：${ctx.reviewFeedback}` : '',
        '',
        `先读上一轮完整回执 ${ctx.fixPreviousReceipt ?? a.receipt}：已通过的任务**原样保留**（status/files 不变），
只更新失败任务；把**完整回执**写到 ${a.receipt}（不是只写失败项）。`,
        `产物契约（写入 ${a.receipt}）：`,
        `{"goalId":"${ctx.goalId}","timestamp":"<ISO>","receipts":[{"taskId":"w1-t1","status":"done|failed|skipped","summary":"一句话","files":["改动文件"]}]}`,
        '阻塞不停下提问：标 failed 并写明原因。用 TDD，跑测试验证。',
      ].filter(Boolean).join('\n');
    }
    return [
      head, docs, retryContext, '',
      `任务：读 ${a.waves}，逐 wave 执行。每完成一个任务把回执写入 ${a.receipt}（写完整个 JSON，覆盖式更新）。`,
      '',
      `产物契约（写入 ${a.receipt}）：`,
      `{"goalId":"${ctx.goalId}","timestamp":"<ISO>","receipts":[{"taskId":"w1-t1","status":"done|failed|skipped","summary":"一句话","files":["改动文件"]}]}`,
      '阻塞不停下提问：标 failed 并写明原因。用 TDD，跑测试验证。',
    ].join('\n');
  }

  const acceptanceLines = Object.entries(ctx.acceptance ?? {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([taskId, items]) => `- ${taskId}：${items.join(' / ')}`);

  const goalLines = (ctx.goalConditions ?? [])
    .filter((condition) => condition && typeof condition.id === 'string' && condition.id)
    .map((condition) => `- ${condition.id}${condition.required ? '（必需）' : ''}：${condition.statement}（证据：${condition.evidence}；方法：${condition.method}）`);

  return [
    head, docs, retryContext, '',
    `任务：独立验证本轮执行结果。读 charter、${a.waves}、回执 ${a.receipt}，用只读工具与测试命令复核（不信任回执自述）。`,
    ctx.reviewFeedback ? `上轮 review 参考：${ctx.reviewFeedback}` : '',
    acceptanceLines.length > 0 ? `任务验收标准（判定依据，不要另立口径）：\n${acceptanceLines.join('\n')}` : '',
    goalLines.length > 0
      ? `Goal 验收条件（逐条判定，任务全部通过不能代替）：\n${goalLines.join('\n')}`
      : '',
    '',
    `把评审报告（markdown）写入 ${a.review}，文件末尾必须包含：`,
    '```mafw-review',
    '{"verdict":"PASS|FAIL","tasks":[{"taskId":"w1-t1","result":"pass|fail|skipped","evidence":"跑了什么命令/看了哪个文件"}],"feedback":"FAIL 时给具体修复指引"}',
    '```',
    '`tasks` 必须覆盖 waves.json 里的**每一个** taskId（缺一个即判为无效评审）；',
    '`evidence` 写可复现的验证依据（命令 + 结果摘要或文件路径），不要写"看起来没问题"。',
    goalLines.length > 0
      ? `在 JSON 中追加 \`"goalResults":[{"conditionId":"g1","result":"pass|fail|skipped","evidence":"..."}]\`，覆盖**每一条必需的** Goal 条件（缺一条即判为无效评审）；必需条件 fail 或缺证据时 verdict 必须是 FAIL。`
      : '',
    '只要有一个任务 fail，verdict 必须是 FAIL。',
  ].filter(Boolean).join('\n');
}
