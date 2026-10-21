/**
 * claude adapter 插件入口 —— loader require() 契约（named exports → CJS）。
 *
 * 零 gateway 核心改动验收线（spec §6）：本文件与其依赖全部住在 adapters/claude/，
 * esbuild 打包为单文件 CJS（SDK 随包），落 ~/.mafw/runtime-plugins/claude.js。
 * claude CLI 与登录是环境前置（SDK spawn CLI，二进制不可打包）。
 *
 * 双执行器说明：runtime 的 spawn 循环经本地 translateClaudeEvent 预翻译后推
 * canonical 事件（pi PiEventStream 同款）；此处声明的 eventSource/eventMappings/
 * transformEvent 供 loader 校验 + wrapGlobalEventStream 兜底（总线 canonical 产物
 * 走信封恒等放行）。Task 4 验收测试钉两张执行器（本地迷你 vs gateway 真执行器）
 * 对同一 fixtures 输出等价——语义漂移探测器。
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
  sessionStorageApi: true,
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
export const eventSource = CLAUDE_EVENT_SOURCE;
export const eventMappings = CLAUDE_EVENT_MAPPINGS;
export const transformEvent = claudeTransformEvent;

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
