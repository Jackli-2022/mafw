// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as path from 'path';
import type { OutputSchemaSpec } from '../../runtime/structured-output';

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
              tasks: { type: 'array', items: { type: 'string' } },
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
  required: ['verdict', 'feedback'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
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

export function nodeArtifactPaths(mafwDir: string, goalId: string, round: number): NodeArtifactPaths {
  return {
    waves: path.join(mafwDir, 'waves.json'),
    receipt: path.join(mafwDir, 'receipts', goalId, `loop-${round}-receipt.json`),
    review: path.join(mafwDir, 'reviews', `${goalId}-loop${round}.md`),
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
  /** W4：能力账本 + 失败谱块（仅 plan 节点注入，规划时主动规避反复失败）。 */
  priorBlock?: string;
  /** D4b：反事实推演块（仅 plan 节点注入，pre-mortem）。 */
  counterfactualBlock?: string;
}

export function renderNodePrompt(node: 'plan' | 'execute' | 'review', ctx: NodePromptCtx): string {
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round);
  const head = `【MAFW Goal ${ctx.goalId} · loop ${ctx.round}/${ctx.maxRounds}】`;
  const docs = `charter: ${ctx.charterPath}\nrequest: ${ctx.requestPath}`;

  if (node === 'plan') {
    return [
      head, docs, '',
      ctx.priorBlock || '',
      ctx.counterfactualBlock || '',
      `任务：阅读 charter 与仓库现状，产出 wave 执行计划，写入 ${a.waves}。`,
      ctx.round > 1 && ctx.reviewFeedback
        ? `上一轮 review 指出的问题（本轮计划必须消化）：\n${ctx.reviewFeedback}` : '',
      '',
      `产物契约（必须是合法 JSON，写入 ${a.waves}）：`,
      '{"taskType":"feature|bugfix|refactor|research|docs|test|other","waves":[{"id":"w1","title":"...","tasks":["..."],"riskNote":"此 wave 最可能的失败 + 对应缓解"}],"status":"ready"}',
      '顶层 taskType 与每 wave 的 riskNote 为 D4b 反事实要求（判断任务类型；对照历史失败模式为每个 wave 预设缓解）。',
      '若存在无法自行消除的歧义：{"status":"need_clarification","ambiguities":["问题..."]}',
    ].filter(Boolean).join('\n');
  }

  if (node === 'execute') {
    return [
      head, docs, '',
      `任务：读 ${a.waves}，逐 wave 执行。每完成一个任务把回执写入 ${a.receipt}（写完整个 JSON，覆盖式更新）。`,
      '',
      `产物契约（写入 ${a.receipt}）：`,
      `{"goalId":"${ctx.goalId}","timestamp":"<ISO>","receipts":[{"taskId":"w1-t1","status":"done|failed|skipped","summary":"一句话","files":["改动文件"]}]}`,
      '阻塞不停下提问：标 failed 并写明原因。用 TDD，跑测试验证。',
    ].join('\n');
  }

  return [
    head, docs, '',
    `任务：独立验证本轮执行结果。读 charter、${a.waves}、回执 ${a.receipt}，用只读工具与测试命令复核（不信任回执自述）。`,
    ctx.reviewFeedback ? `上轮 review 参考：${ctx.reviewFeedback}` : '',
    '',
    `把评审报告（markdown）写入 ${a.review}，文件末尾必须包含：`,
    '```mafw-review',
    '{"verdict":"PASS|FAIL","feedback":"FAIL 时给具体修复指引"}',
    '```',
  ].filter(Boolean).join('\n');
}
