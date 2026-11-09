import type { RuntimeChannels, RuntimeChannelsV2 } from './channels.ts';
import type { RuntimeTransport } from './transport.ts';

export type RuntimePreset = 'core' | 'conversation' | 'autonomous' | 'desktop';

export interface RuntimeCapabilities {
  sessionApi: boolean;
  promptWhileBusy: boolean;
  eventStream: boolean;
  nativeApprovals: boolean;
  providerConfigApi: boolean;
  perLlmCallTransform: boolean;
  sessionStorageApi?: boolean;
  agentConfigApi?: boolean;
  agentProcessApi?: boolean;
  completionApi?: boolean;
  sessionBranchApi?: boolean;
  revertUndoApi?: boolean;
  checkpointApi?: boolean;
  runStateApi?: boolean;
  turnBudgetApi?: boolean;
  questionApi?: boolean;
  diffApi?: boolean;
  worktreeApi?: boolean;
  instructionsApi?: boolean;
  discoveryApi?: boolean;
  mcpApi?: boolean;
  mcpConfigApi?: boolean;
  steerApi?: boolean;
  pluginCreatorApi?: boolean;
}

export interface RuntimeManifest {
  install?: unknown;
  auth?: unknown;
  models?: unknown;
  nativeTools?: unknown[];
  configSchema?: unknown;
}

export interface RuntimeDefinitionInput {
  api: 1;
  name: string;
  displayName: string;
  preset: RuntimePreset;
  transport: RuntimeTransport;
  /** true = the runtime process is user-managed; the gateway never spawns or kills it. */
  external?: boolean;
  channels?: RuntimeChannels;
  channelsV2?: RuntimeChannelsV2;
  channelApi?: 1 | 2;
  eventApi?: 1;
  manifest?: RuntimeManifest;
  /** Explicit semantic bits that cannot be derived from method presence. */
  overrides?: Partial<RuntimeCapabilities>;
}

export class RuntimeUnsupportedError extends Error {
  readonly code = 'ENODEV';
  readonly surface: string;

  constructor(surface: string) {
    super(`runtime does not support ${surface}`);
    this.name = 'RuntimeUnsupportedError';
    this.surface = surface;
  }
}

export interface RuntimeDefinition extends RuntimeDefinitionInput {
  eventApi: 1;
  channelApi: 1 | 2;
  capabilities: RuntimeCapabilities;
  /** Throws a neutral ENODEV error for a missing surface. */
  unsupported(surface: string): RuntimeUnsupportedError;
}

const BASE_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: false,
  promptWhileBusy: false,
  eventStream: false,
  nativeApprovals: false,
  providerConfigApi: false,
  perLlmCallTransform: false,
  sessionStorageApi: false,
  agentConfigApi: false,
  agentProcessApi: false,
  completionApi: false,
  sessionBranchApi: false,
  revertUndoApi: false,
  checkpointApi: false,
  runStateApi: false,
  turnBudgetApi: false,
  questionApi: false,
  diffApi: false,
  worktreeApi: false,
  instructionsApi: false,
  discoveryApi: false,
  mcpApi: false,
  mcpConfigApi: false,
  steerApi: false,
  pluginCreatorApi: false,
};

export function deriveCapabilities(input: RuntimeDefinitionInput): RuntimeCapabilities {
  const channels = input.channels ?? {};
  const v2 = input.channelsV2 ?? {};
  const transport = input.transport;
  return {
    ...BASE_CAPABILITIES,
    sessionApi: typeof transport.createSession === 'function' && typeof transport.sendTurn === 'function',
    eventStream: typeof transport.onEvent === 'function',
    nativeApprovals: typeof transport.respondToRequest === 'function',
    steerApi: typeof transport.steer === 'function',
    promptWhileBusy: typeof transport.steer === 'function',
    questionApi: typeof channels.question?.list === 'function',
    sessionBranchApi: Boolean(channels.branch?.fork || channels.branch?.revert),
    diffApi: typeof channels.diff?.get === 'function',
    completionApi: typeof channels.completion?.complete === 'function',
    mcpApi: Boolean(v2.mcp),
    discoveryApi: Boolean(v2.discovery),
    instructionsApi: Boolean(v2.instructions),
    checkpointApi: Boolean(v2.checkpoint),
    ...input.overrides,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function defineRuntime(input: RuntimeDefinitionInput): RuntimeDefinition {
  assert(input && typeof input === 'object', 'defineRuntime: input is required');
  assert(input.api === 1, `defineRuntime: unsupported api ${String((input as { api?: unknown }).api)}`);
  assert(!('native' in input), 'defineRuntime: native is not allowed; use transport + channels');
  assert(typeof input.name === 'string' && input.name.length > 0, 'defineRuntime: name is required');
  assert(typeof input.displayName === 'string' && input.displayName.length > 0, 'defineRuntime: displayName is required');
  assert(input.transport && typeof input.transport === 'object', 'defineRuntime: transport is required');
  assert(typeof input.transport.createSession === 'function', 'defineRuntime: transport.createSession is required');
  assert(typeof input.transport.sendTurn === 'function', 'defineRuntime: transport.sendTurn is required');
  assert(typeof input.transport.interruptTurn === 'function', 'defineRuntime: transport.interruptTurn is required');
  assert(typeof input.transport.onEvent === 'function', 'defineRuntime: transport.onEvent is required');
  const eventApi = input.eventApi ?? 1;
  assert(eventApi === 1, `defineRuntime: unsupported eventApi ${String(eventApi)}`);
  const channelApi = input.channelApi ?? (input.channelsV2 ? 2 : 1);
  assert(channelApi === 1 || channelApi === 2, `defineRuntime: unsupported channelApi ${String(channelApi)}`);
  assert(channelApi === 2 || input.channelsV2 === undefined, 'defineRuntime: channelsV2 requires channelApi 2');

  return {
    ...input,
    eventApi,
    channelApi,
    capabilities: deriveCapabilities({ ...input, eventApi }),
    unsupported: (surface: string) => new RuntimeUnsupportedError(surface),
  };
}
