// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as fs from 'fs';
import * as path from 'path';
import type { OutputSchemaSpec } from '../../runtime/structured-output';
import type { FailureClass } from './failure-class';
import type { GoalEval, GoalEvalCondition } from './goal-eval';
import { validateGoalEval } from './goal-eval';
import type { ExecutableGoalNode } from './node-names';
import { PROBE_COMMAND_CLASSES, type ProbeReport, type ProbeRequest } from './probe';

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

/**
 * ProbeRequest 的**可执行范围**（spec §6.5）：路径 / 命令类别 / 网络 / 凭据 / 预算
 * 必须是机器可读字段。计划模型只提供这些声明，id/podId/revision 由 driver 注入。
 */
const PROBE_DRAFT_SCHEMA = {
  type: 'object',
  required: ['question', 'hypothesis', 'scope', 'budget', 'evidenceRequired'],
  properties: {
    question: { type: 'string', maxLength: 2000 },
    hypothesis: { type: 'string', maxLength: 2000 },
    scope: {
      type: 'object',
      required: ['paths', 'commandClasses', 'network', 'credentials'],
      properties: {
        paths: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        commandClasses: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: [...PROBE_COMMAND_CLASSES] },
        },
        network: { type: 'boolean' },
        credentials: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      },
    },
    budget: {
      type: 'object',
      required: ['maxMinutes', 'maxUsd'],
      properties: {
        maxMinutes: { type: 'number', exclusiveMinimum: 0 },
        maxUsd: { type: 'number', minimum: 0 },
      },
    },
    evidenceRequired: { type: 'array', minItems: 1, items: { type: 'string' } },
    affects: {
      type: 'object',
      properties: {
        planAssertions: { type: 'array', items: { type: 'string' } },
        evalMethods: { type: 'array', items: { type: 'string' } },
        options: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

/** 计划主体（waves）：ready 与 need_probe（Task 15 full_chain）两种状态共用同一形状。 */
const WAVES_SCHEMA = {
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
} as const;

/** Task 15：探针结论 → 下一步（continue = 直接实施 / reapprove = 重新批准）。 */
const CONTINUATION_RULE_SCHEMA = {
  type: 'object',
  properties: {
    supports: { type: 'string', enum: ['continue', 'reapprove'] },
    refutes: { type: 'string', enum: ['continue', 'reapprove'] },
    inconclusive: { type: 'string', enum: ['continue', 'reapprove'] },
  },
} as const;

const PLAN_OUTPUT_SCHEMA = {
  anyOf: [
    {
      // Tech Lead chooses quick: one Worker, no independent review, no mandatory
      // Goal Eval. Driver still enforces exactly one task and the manual plan gate.
      type: 'object',
      required: ['status', 'taskType', 'strategy', 'waves'],
      properties: {
        status: { const: 'ready' },
        strategy: { const: 'quick' },
        taskType: { type: 'string', enum: [...TASK_TYPES] },
        goalEval: GOAL_EVAL_SCHEMA,
        waves: WAVES_SCHEMA,
      },
    },
    {
      type: 'object',
      required: ['status', 'taskType', 'waves', 'goalEval'],
      properties: {
        status: { const: 'ready' },        taskType: { type: 'string', enum: [...TASK_TYPES] },
        goalEval: GOAL_EVAL_SCHEMA,
        waves: WAVES_SCHEMA,
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
    {
      // Task 14：关键技术假设无法只靠读代码消除 → 先让 Builder 做隔离 Spike，
      // 拿到 ProbeReport 后再提交最终 ready 计划（两段式，spec §6.3）。
      // Task 15：full_chain —— 同时给出实施计划与规则，用户一次批准整条链。
      type: 'object',
      required: ['status', 'probes'],
      properties: {
        status: { const: 'need_probe' },
        probes: { type: 'array', minItems: 1, maxItems: 4, items: PROBE_DRAFT_SCHEMA },
        approvalMode: { type: 'string', enum: ['two_stage', 'full_chain'] },
        taskType: { type: 'string', enum: [...TASK_TYPES] },
        waves: WAVES_SCHEMA,
        goalEval: GOAL_EVAL_SCHEMA,
        continuation: {
          type: 'object',
          additionalProperties: CONTINUATION_RULE_SCHEMA,
        },
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

const PROBE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['probeId', 'conclusion', 'commands', 'keyOutput', 'repro', 'remainingAssumptions', 'impact'],
  properties: {
    probeId: { type: 'string' },
    conclusion: { type: 'string', enum: ['supports', 'refutes', 'inconclusive'] },
    commands: { type: 'array', items: { type: 'string' } },
    keyOutput: { type: 'string' },
    repro: { type: 'array', items: { type: 'string' } },
    remainingAssumptions: { type: 'array', items: { type: 'string' } },
    impact: {
      type: 'object',
      properties: { plan: { type: 'string' }, goalEval: { type: 'string' } },
    },
  },
} as const;

/** Goal 节点结构化交卷 schema（与文件产物同字段；structured 优先、文件 fallback）。 */
export function nodeOutputSchema(node: ExecutableGoalNode): OutputSchemaSpec {
  if (node === 'plan') return { name: 'goal.plan', schema: PLAN_OUTPUT_SCHEMA as unknown as Record<string, any> };
  if (node === 'probe') return { name: 'goal.probe', schema: PROBE_OUTPUT_SCHEMA as unknown as Record<string, any> };
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
  /**
   * Task 17：确定性的 ContextManifest 块（阶段基线 + Lead 选入的引用）。
   * 永远渲染在整个 prompt 的最前面——worker 先看到「哪些文件是权威的」，
   * 再看到任务正文；Pod handoff / 记忆块由 driver 排在它之后。
   */
  manifestBlock?: string;
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
  /** 同轮复核：评审内容缺口（缺证据 / 漏任务 / 漏必需条件）——定向修复的额外目标。 */
  fixOmissions?: string[];
  /** 同轮复核的复评：review 节点也必须写 `-fix` 产物（与 execute 修复同源）。 */
  reviewFixPass?: boolean;
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
  /** Task 14：Spike 节点上下文（probe 节点在隔离工作区里跑）。 */
  probe?: {
    request: ProbeRequest;
    workspaceDir: string;
    reportPath: string;
  };
  /** Task 14：已完成的 ProbeReport（plan 节点注入——探针证据是计划的输入）。 */
  probeReports?: ProbeReport[];
  /** Task 14：本 revision 的探针额度（plan 节点据此收敛 need_probe 次数）。 */
  probeBudget?: { max: number; used: number; remaining: number };
  attempt?: number;
  maxAttempts?: number;
  lastFailure?: {
    class: FailureClass;
    code: string;
    message: string;
    node: ExecutableGoalNode;
    attempt: number;
    at: string;
  } | null;
  userAnswer?: string;
  userQuestions?: string[];
}

/** 计划上下文里的探针证据块（截断 keyOutput，避免一份报告吃掉整个 prompt）。 */
export function renderProbeReportBlock(reports: ProbeReport[]): string {
  if (!reports.length) return '';
  const lines = reports.map((report) => {
    const output = String(report.keyOutput ?? '').replace(/\s+/g, ' ').trim();
    const clipped = output.length > 800 ? `${output.slice(0, 800)}…` : output;
    const remaining = report.remainingAssumptions?.length
      ? `；剩余假设：${report.remainingAssumptions.join(' / ')}`
      : '';
    const impact = report.impact?.plan ? `；对计划的影响：${report.impact.plan}` : '';
    return `- ${report.probeId} [${report.conclusion}] 关键输出：${clipped}${remaining}${impact}`;
  });
  return [
    'Probe 报告（Builder 已验证的事实；涉及假设以报告为准，refutes/inconclusive 不得当作已解决）：',
    ...lines,
  ].join('\n');
}

export function renderNodePrompt(node: ExecutableGoalNode, ctx: NodePromptCtx): string {
  const body = renderNodePromptBody(node, ctx);
  // ContextManifest 恒在最前（不含记忆/任务板内容）；无 manifest 时保持旧 prompt 零迁移。
  return ctx.manifestBlock ? `${ctx.manifestBlock}\n\n${body}` : body;
}

function renderNodePromptBody(node: ExecutableGoalNode, ctx: NodePromptCtx): string {
  const isFixPass = node === 'execute' && (!!ctx.fixTasks?.length || !!ctx.fixOmissions?.length);
  // 复评必须写 `-fix` 产物：driver 的完成判定（inflightArtifactPath）与消费端
  // 都以 `state.reviewFix.round === round` 为准，prompt 不能还指向 loop-N.md，
  // 否则按提示写出的评审会 artifact_missing（final review 实证）。
  const useFixArtifacts = isFixPass || (node === 'review' && !!ctx.reviewFixPass);
  const revision = normalizeArtifactRevision(ctx.revision);
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round, { fix: useFixArtifacts, revision });
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

  if (node === 'probe') {
    const probe = ctx.probe;
    if (!probe) return [head, docs, retryContext, '', '任务：缺少 ProbeRequest 上下文，无法执行验证。'].filter(Boolean).join('\n');
    const scope = probe.request.scope;
    return [
      head, docs, retryContext, '',
      `任务：执行一次**技术验证（Spike）**，回答计划里的不确定问题。工作目录是隔离工作区 ${probe.workspaceDir}；`,
      `主项目（只读源码）：${ctx.projectDir}——读工具只能读「允许范围 · 路径」声明内的文件（相对主项目根解析，绝对路径也可以）；`,
      '主项目只读——不得写入主工作区（会被拒绝）、不得改动正式实施 diff；需要写文件时一律写在隔离工作区里，验证代码可丢弃。',
      '',
      `问题：${probe.request.question}`,
      `当前假设：${probe.request.hypothesis}`,
      `允许范围（必须是机器可读声明，越界必须停下并如实报告）：`,
      `- 路径：${scope.paths.join(', ') || '（无，只推理）'}（相对隔离工作区与主项目根；主项目内只读）`,
      `- 命令类别：${scope.commandClasses.join(', ')}`,
      `- 网络：${scope.network ? '允许' : '不允许'}`,
      `- 凭据：${scope.credentials.join(', ') || '（无）'}`,
      `- 预算：${probe.request.budget.maxMinutes} 分钟 / $${probe.request.budget.maxUsd}（超过 ${probe.request.budget.maxMinutes} 分钟会被强制终止并记为失败）`,
      `需要的证据：${probe.request.evidenceRequired.join('；')}`,
      probe.request.affects?.planAssertions?.length
        ? `本探针要影响的计划断言：${probe.request.affects.planAssertions.join('；')}`
        : '',
      '',
      `把报告（合法 JSON）写入 ${probe.reportPath}：`,
      `{"probeId":"${probe.request.id}","conclusion":"supports|refutes|inconclusive","commands":["实际执行的命令"],"keyOutput":"关键输出（脱敏）","repro":["复现步骤"],"remainingAssumptions":["仍存在的假设"],"impact":{"plan":"对计划的具体影响","goalEval":"对验收方法的具体影响"}}`,
      '结论必须来自真实执行；做不到就写 inconclusive 并说明卡在哪里，不要编造证据。',
    ].filter(Boolean).join('\n');
  }

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
      ctx.probeBudget
        ? `探针额度（第 ${revision} 版）：本版最多 ${ctx.probeBudget.max} 条（已报告 + 排队合计已用 ${ctx.probeBudget.used} 条，剩余 ${ctx.probeBudget.remaining} 条）。额度耗尽后 need_probe 会被拒绝，必须基于现有证据给出最终计划。`
        : '',
      ctx.priorBlock || '',
      ctx.counterfactualBlock || '',
      renderProbeReportBlock(ctx.probeReports ?? []),
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
      '若关键技术假设无法只靠读代码确认（路线不清、风险高、可能改变方案）：先提交两段式验证请求，不要猜：',
      '{"status":"need_probe","probes":[{"question":"要回答的技术问题","hypothesis":"当前假设","scope":{"paths":["允许访问的相对路径（主项目内只读、工作区内可写）"],"commandClasses":["read|search|build|test|lint|format|install|shell"],"network":false,"credentials":[]},"budget":{"maxMinutes":20,"maxUsd":2},"evidenceRequired":["需要看到什么证据"],"affects":{"planAssertions":["受影响的计划断言"]}}]}',
      'need_probe 只申请**隔离、只读**的验证；Builder 会在独立临时目录执行并返回 ProbeReport，之后你要提交最终 ready 计划（证据进入你的下一轮上下文）。',
      ctx.planReview === 'manual'
        ? [
          '整链批准选项（仅当你能同时给出可实施的 waves + goalEval，用户就会一次性批准整条链）：',
          '{"status":"need_probe","approvalMode":"full_chain","waves":[...],"goalEval":{...},"probes":[...],"continuation":{"default":{"supports":"continue","refutes":"reapprove","inconclusive":"reapprove"}}}',
          'full_chain 在探针执行**之前**请用户批准整包；探针结论全部解析为 continue 才直接进入实施，不再有第二次计划门。任何 reapprove、没有命中 continuation 规则的结论（未预期结果）或计划内容被改动都会让批准作废并回到规划。',
          'continuation 必须覆盖每个探针可能给出的结论：用 `default` 兜底所有探针（探针 id 由运行时分发，计划里通常只需 default），必要时再按具体 id 覆盖。规则不确定时用 reapprove——猜错会直接跑错实施。',
        ].join('\n')
        : '',
      '若存在无法自行消除的歧义：{"status":"need_clarification","ambiguities":["问题..."]}',
    ].filter(Boolean).join('\n');
  }

  if (node === 'execute') {
    if (isFixPass) {
      const failed = (ctx.fixTasks ?? [])
        .map((task) => `- ${task.taskId}：${task.evidence || "（reviewer 未给证据）"}`)
        .join('\n');
      const omissions = (ctx.fixOmissions ?? []).map((item) => `- ${item}`).join('\n');
      return [
        head, docs, retryContext, '',
        `任务：**同轮复核修复**。上一轮 review 判定以下任务未通过，只修这些，不要扩大范围：`,
        failed || '（没有逐任务失败项。）',
        omissions ? `评审缺口（必须补齐可验证证据，逐条覆盖）：\n${omissions}` : '',
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
    ctx.reviewFixPass
      ? '本轮是**同轮复核（复评）**：只复核上一轮失败项/评审缺口与回归，评审报告必须写到上面的 `-fix` 路径（不要写 loop-N.md）。'
      : '',
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
