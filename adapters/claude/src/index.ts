/**
 * claude adapter entry.
 *
 * - `createRuntimeDefinition` / `createClaudeDefinition`: the neutral entry
 *   (RuntimeDefinition + AdapterEvent transport).
 * - `createRuntime`: the old AgentRuntime entry, kept for the one-release
 *   legacy bridge and existing plugin-check tests.
 */
import { defineRuntime, type RuntimeDefinition, type RuntimeFactoryContext } from '@mafw/runtime-contract';
import { createClaudeRuntime, type ClaudeSdk, type ClaudeRuntimeDeps } from './runtime.ts';
import { createClaudeTransport } from './transport.ts';
import { createClaudeChannels } from './channels.ts';

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
export { CLAUDE_EVENT_SOURCE as eventSource, CLAUDE_EVENT_MAPPINGS as eventMappings, claudeTransformEvent as transformEvent } from './events.ts';

/** Offline checker sample (mfaw plugin-check); the loader ignores it. */
export const sampleEvents = [
  { type: 'system', subtype: 'init', session_id: 'sample', model: 'claude-sample' },
  { type: 'result', subtype: 'success', session_id: 'sample', usage: { input_tokens: 1, output_tokens: 1 } },
];

export async function createClaudeDefinition(
  ctx: RuntimeFactoryContext,
  deps: { sdk?: ClaudeSdk } = {},
): Promise<RuntimeDefinition> {
  const sdk = deps.sdk ?? (await import('@anthropic-ai/claude-agent-sdk')) as unknown as ClaudeSdk;
  const transport = createClaudeTransport({ sdk, gatewayPort: ctx?.gatewayPort });
  const channels = createClaudeChannels(sdk);
  return defineRuntime({
    api: 1,
    name: 'claude',
    displayName: 'Claude Code',
    preset: 'conversation',
    transport,
    channels,
    overrides: { promptWhileBusy: true, worktreeApi: true },
  });
}

export async function createRuntimeDefinition(ctx: RuntimeFactoryContext): Promise<RuntimeDefinition> {
  return createClaudeDefinition(ctx);
}

/** @deprecated one-release legacy entry; use createRuntimeDefinition. */
export async function createRuntime(ctx: any): Promise<any> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return createClaudeRuntime({
    sdk: {
      query: (args: any) => sdk.query(args),
      listSessions: () => sdk.listSessions(),
      getSessionMessages: (sessionId: string) => sdk.getSessionMessages(sessionId),
    },
    gatewayPort: ctx?.gatewayPort,
  } as ClaudeRuntimeDeps);
}
