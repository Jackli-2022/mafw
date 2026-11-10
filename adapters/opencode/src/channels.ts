/**
 * Neutral v1/v2 channels for the opencode driver (Phase 4 W2).
 *
 * Lifts the presence-check wiring from the legacy bridge into direct adapter
 * mapping. Native behavior stays in `adapter.ts` / `mcp.ts` / `mcp-config.ts` /
 * `snapshot.ts`; this module only narrows to the contract DTOs.
 */
import type { RuntimeChannels, RuntimeChannelsV2 } from '@mafw/runtime-contract';
import type { OpencodeRuntime } from './types';

export interface OpencodeChannels {
  channels: RuntimeChannels;
  channelsV2: RuntimeChannelsV2;
}

export function createOpencodeChannels(runtime: OpencodeRuntime): OpencodeChannels {
  const channels: RuntimeChannels = {};
  if (runtime.tools) {
    channels.tools = {
      registerTools: (factory) => runtime.tools!.registerTools(factory as any),
      nativeTools: () => runtime.tools!.nativeTools?.() ?? [],
    };
  }
  if (runtime.session.messages) {
    channels.messages = {
      list: async (sessionID, opts) => runtime.session.messages!({ sessionID, limit: opts?.limit, before: opts?.before } as any),
      ...(typeof runtime.session.normalizeMessages === 'function'
        ? { normalize: runtime.session.normalizeMessages as any }
        : {}),
    };
  }
  channels.session = {
    list: runtime.session.list ? async (opts) => runtime.session.list!({ directory: opts?.directory } as any) : undefined,
    get: runtime.session.get ? async (sessionID) => runtime.session.get!({ sessionID }) : undefined,
    update: runtime.session.update
      ? async (sessionID, patch) => runtime.session.update!({ sessionID, title: patch.title ?? '' })
      : undefined,
    delete: runtime.session.delete ? async (sessionID) => runtime.session.delete!({ sessionID }) : undefined,
    abort: async (sessionID) => runtime.session.abort({ sessionID }),
    listByDirectory: runtime.session.listByDirectory
      ? async (directory, limit) => runtime.session.listByDirectory!(directory, limit)
      : undefined,
    todo: runtime.session.todo ? async (sessionID) => runtime.session.todo!({ sessionID }) : undefined,
    children: runtime.session.children ? async (sessionID) => runtime.session.children!({ sessionID }) : undefined,
    summarize: runtime.session.summarize ? async (input) => runtime.session.summarize!(input) : undefined,
    switchAgent: runtime.session.switchAgent
      ? async (sessionID, agent) => runtime.session.switchAgent!({ sessionID, agent })
      : undefined,
    switchModel: runtime.session.switchModel
      ? async (sessionID, model) => runtime.session.switchModel!({ sessionID, model, variant: model.variant })
      : undefined,
    setThinkingLevel: runtime.session.setThinkingLevel
      ? async (sessionID, level) => runtime.session.setThinkingLevel!({ sessionID, level })
      : undefined,
    permissionList: runtime.session.permissionList
      ? async (opts) => runtime.session.permissionList!(opts)
      : undefined,
    background: runtime.session.background
      ? async (sessionID) => runtime.session.background!({ sessionID })
      : undefined,
  } as RuntimeChannels['session'];
  if (runtime.provider?.list) channels.providers = { list: () => runtime.provider.list() };
  if (runtime.agents || runtime.app?.agents) {
    channels.agents = {
      list: async () => runtime.app?.agents ? runtime.app.agents() : ((runtime.agents as any)?.list?.() ?? []),
      install: (name, definition) => runtime.agents!.install(name, definition as any),
      remove: runtime.agents?.remove,
    };
  }
  if (runtime.session.fork || runtime.session.revert || runtime.session.unrevert) {
    channels.branch = {
      fork: runtime.session.fork
        ? async (sessionID, messageID) => {
            const result = await runtime.session.fork!({ sessionID, messageID });
            return { sessionID: String((result as any)?.id ?? (result as any)?.sessionID) };
          }
        : undefined,
      revert: runtime.session.revert
        ? (sessionID, messageID, opts) => runtime.session.revert!({ sessionID, messageID, files: opts?.files })
        : undefined,
      unrevert: runtime.session.unrevert ? (sessionID) => runtime.session.unrevert!({ sessionID }) : undefined,
    };
  }
  if (runtime.session.diff || runtime.session.vcs) {
    channels.diff = {
      get: runtime.session.diff
        ? ((sessionID: string, messageID?: string) => runtime.session.diff!({ sessionID, messageID })) as any
        : undefined,
      vcsDiff: runtime.session.vcs?.diff ? (opts) => runtime.session.vcs!.diff!(opts) : undefined,
      vcsApply: runtime.session.vcs?.apply ? (patch) => runtime.session.vcs!.apply!({ patch }) : undefined,
    };
  }
  if (runtime.session.question) channels.question = runtime.session.question;
  if (runtime.completion) channels.completion = runtime.completion as any;
  if (runtime.shell) channels.shell = runtime.shell as any;
  if (runtime.mediaSession) {
    channels.mediaSession = {
      create: async (opts) => {
        const created = await runtime.mediaSession!.create({ directory: opts.directory });
        return { sessionID: String((created as any)?.id ?? (created as any)?.sessionID) };
      },
    };
  }

  const channelsV2: RuntimeChannelsV2 = {};
  if (runtime.mcp) channelsV2.mcp = runtime.mcp;
  if (runtime.discovery) channelsV2.discovery = runtime.discovery as unknown as RuntimeChannelsV2['discovery'];
  if (runtime.session.instructions) channelsV2.instructions = runtime.session.instructions as RuntimeChannelsV2['instructions'];
  if (runtime.pty) channelsV2.pty = runtime.pty;
  if (runtime.snapshotTree) channelsV2.checkpoint = { locate: (opts) => runtime.snapshotTree!.locate(opts) };
  if (runtime.session.background) {
    channelsV2.background = { toBackground: (sessionID) => runtime.session.background!({ sessionID }) };
  }
  return { channels, channelsV2 };
}
