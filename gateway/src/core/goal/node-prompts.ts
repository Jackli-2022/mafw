// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as path from 'path';
import type { OutputSchemaSpec } from '../../runtime/structured-output';
import type { FailureClass } from './failure-class';
import type { GoalEvalCondition } from './goal-eval';

const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'research', 'docs', 'test', 'other'] as const;

const PLAN_OUTPUT_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      required: ['status', 'taskType', 'waves'],
      properties: {
        status: { const: 'ready' },
        taskType: { type: 'string', enum: [...TASK_TYPES] },
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

export function nodeArtifactPaths(
  mafwDir: string,
  goalId: string,
  round: number,
  opts: { fix?: boolean } = {},
): NodeArtifactPaths {
  const suffix = opts.fix ? '-fix' : '';
  return {
    waves: path.join(mafwDir, 'waves.json'),
    receipt: path.join(mafwDir, 'receipts', goalId, `loop-${round}${suffix}-receipt.json`),
    review: path.join(mafwDir, 'reviews', `${goalId}-loop${round}${suffix}.md`),
  };
}

export interface NodePromptCtx {
  goalId: string;
  projectDir: string;
  mafwDir: string;
  round: number;
  maxRounds: number;
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
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round, { fix: isFixPass });
  const head = `【MAFW Goal ${ctx.goalId} · loop ${ctx.round}/${ctx.maxRounds}】`;
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
      ctx.priorBlock || '',
      ctx.counterfactualBlock || '',
      ctx.planFeedback
        ? `上一版计划被驳回，用户意见（本轮计划必须消化）：\n${ctx.planFeedback}` : '',
      `任务：阅读 charter 与仓库现状，产出 wave 执行计划，写入 ${a.waves}。`,
      ctx.round > 1 && ctx.reviewFeedback
        ? `上一轮 review 指出的问题（本轮计划必须消化）：\n${ctx.reviewFeedback}` : '',
      '',
      `产物契约（必须是合法 JSON，写入 ${a.waves}）：`,
      '{"taskType":"feature|bugfix|refactor|research|docs|test|other","waves":[{"id":"w1","title":"...","tasks":[{"title":"...","acceptance":["可验证标准 1","可验证标准 2"]}],"riskNote":"此 wave 最可能的失败 + 对应缓解"}],"status":"ready"}',
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
