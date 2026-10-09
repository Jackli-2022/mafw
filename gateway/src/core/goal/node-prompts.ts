// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as path from 'path';

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
}

export function renderNodePrompt(node: 'plan' | 'execute' | 'review', ctx: NodePromptCtx): string {
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round);
  const head = `【MAFW Goal ${ctx.goalId} · loop ${ctx.round}/${ctx.maxRounds}】`;
  const docs = `charter: ${ctx.charterPath}\nrequest: ${ctx.requestPath}`;

  if (node === 'plan') {
    return [
      head, docs, '',
      ctx.priorBlock || '',
      `任务：阅读 charter 与仓库现状，产出 wave 执行计划，写入 ${a.waves}。`,
      ctx.round > 1 && ctx.reviewFeedback
        ? `上一轮 review 指出的问题（本轮计划必须消化）：\n${ctx.reviewFeedback}` : '',
      '',
      `产物契约（必须是合法 JSON，写入 ${a.waves}）：`,
      '{"waves":[{"id":"w1","title":"...","tasks":["..."]}],"status":"ready"}',
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
