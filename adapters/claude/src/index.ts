/**
 * claude adapter 插件入口 —— loader require() 契约（named exports → CJS）。
 *
 * raw-event-first：runtime 推原生 SDKMessage，翻译由 gateway 执行器按本文件导出的
 * 声明表完成（single executor，不再有本地迷你执行器）；能力声明也只在
 * module.exports.capabilities 一处（实例不重复声明）。
 */
import { createClaudeRuntime } from './runtime.ts';
import { CLAUDE_EVENT_SOURCE, CLAUDE_EVENT_MAPPINGS, claudeTransformEvent } from './events.ts';

export const name = 'claude';

export const capabilities = {
  sessionApi: true,
  promptWhileBusy: true,
  eventStream: true,
  nativeApprovals: false,
  providerConfigApi: false,
  perLlmCallTransform: false,
  sessionStorageApi: false,
  agentConfigApi: false,
  agentProcessApi: false,
  completionApi: false,
  sessionBranchApi: false,
  turnBudgetApi: false,
  questionApi: false,
  diffApi: false,
  worktreeApi: true,
};

export const external = true;
export const eventTranslation = 'declared' as const;
export const eventSource = CLAUDE_EVENT_SOURCE;
export const eventMappings = CLAUDE_EVENT_MAPPINGS;
export const transformEvent = claudeTransformEvent;
/** 离线检查器样本（mfaw plugin-check 用；loader 忽略）。 */
export const sampleEvents = [
  { type: 'system', subtype: 'init', session_id: 'sample', model: 'claude-sample' },
  { type: 'result', subtype: 'success', session_id: 'sample', usage: { input_tokens: 1, output_tokens: 1 } },
];

export async function createRuntime(ctx: any): Promise<any> {
  // 真 SDK 接线（bundle 内置）；CLI/登录缺失在 prompt 时显式失败为 turn.failed
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return createClaudeRuntime({
    sdk: {
      query: (args: any) => sdk.query(args),
      listSessions: () => sdk.listSessions(),
      getSessionMessages: (sessionId: string) => sdk.getSessionMessages(sessionId),
    },
    gatewayPort: ctx?.gatewayPort,
  });
}
