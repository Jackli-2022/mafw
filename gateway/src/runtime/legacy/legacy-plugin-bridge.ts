/**
 * Temporary one-release bridge for old plugins that export
 * `createRuntime(ctx): AgentRuntime` instead of a RuntimeDefinition.
 *
 * The bridge is generic (no runtime names). It wraps the old object in the
 * neutral transport/channels so the kernel never sees old canonical envelopes.
 */
import { defineRuntime, type AdapterEvent, type RuntimeChannels, type RuntimeChannelsV2, type RuntimeDefinition, type RuntimeTransport } from '@mafw/runtime-contract';
import type { AgentRuntime } from '../contract';
import type { RawRuntimeEvent } from '../normalize';

let sequence = 0;
function nextID(): string {
  sequence += 1;
  return `legacy-${Date.now().toString(36)}-${sequence}`;
}

function propsOf(evt: RawRuntimeEvent): Record<string, any> {
  return (evt.payload?.properties ?? evt.properties ?? {}) as Record<string, any>;
}

function typeOf(evt: RawRuntimeEvent): string {
  return String(evt.payload?.type ?? evt.type ?? '');
}

function sessionOf(evt: RawRuntimeEvent, props: Record<string, any>): string | undefined {
  return props.sessionID ?? props.part?.sessionID ?? props.message?.sessionID ?? props.info?.sessionID ?? props.info?.id ?? evt.sessionID;
}

export interface LegacyBridgeState {
  turns: Map<string, string>;
}

/** Reverse-map the old canonical envelope to AdapterEvent for the core event set. */
export function canonicalToAdapterEvent(evt: RawRuntimeEvent, state: LegacyBridgeState = { turns: new Map() }): AdapterEvent | null {
  const type = typeOf(evt);
  const props = propsOf(evt);
  const sessionID = sessionOf(evt, props);
  if (!type) return null;
  let turnID = typeof props.turnID === 'string' ? props.turnID : (sessionID ? state.turns.get(sessionID) : undefined);
  if (type === 'turn.started' || type === 'usage.updated' || (type.startsWith('turn.') && !turnID)) {
    turnID = turnID ?? `legacy-${sessionID ?? 'session'}-${nextID()}`;
    if (sessionID) state.turns.set(sessionID, turnID);
  }
  const base = {
    id: nextID(),
    sessionID,
    turnID,
    requestID: typeof props.requestId === 'string' ? props.requestId : typeof props.id === 'string' ? props.id : undefined,
    at: Date.now(),
  };
  const make = (t: AdapterEvent['type'], data: unknown): AdapterEvent => ({ ...base, type: t, data } as AdapterEvent);

  switch (type) {
    case 'session.created': return make('session.created', { session: props.info });
    case 'session.updated': return make('session.updated', { patch: props.info });
    case 'session.deleted': return make('session.deleted', {});
    case 'turn.started': return make('turn.started', {});
    case 'turn.completed': return make('turn.completed', { ok: props.ok !== false, stopReason: props.stopReason, usage: props.usage, costUsd: props.cost });
    case 'turn.failed': return make('turn.failed', {
      error: { kind: 'unknown', message: String(props.error?.message ?? props.error ?? 'runtime error') },
      retryable: props.retryable,
    });
    case 'turn.aborted': return make('turn.aborted', { reason: props.reason });
    case 'message.updated': return make('message.updated', { message: props.message });
    case 'part.updated': return make('part.updated', { part: props.part });
    case 'part.delta': return make('part.delta', { messageID: props.messageID, partID: props.partID, field: props.field, delta: props.delta });
    case 'part.complete': return make('part.completed', { part: props.part });
    case 'permission.asked': return make('permission.asked', { request: props });
    case 'permission.replied': return make('permission.replied', { reply: props.reply ?? (props.approved ? 'once' : 'reject'), source: props.source ?? 'user', message: props.message });
    case 'question.asked': return make('question.asked', { request: props });
    case 'question.replied': return make('question.replied', { answers: props.answers });
    case 'question.rejected': return make('question.rejected', {});
    case 'plan.updated': return make('plan.updated', { items: props.todos ?? props.items ?? props });
    case 'usage.updated': return make('usage.updated', { usage: props.usage ?? props, contextTokens: props.contextTokens, contextWindow: props.contextWindow });
    default: return null;
  }
}

export function toRuntimeDefinition(
  legacy: AgentRuntime,
  meta: { name: string; displayName?: string; capabilities?: Record<string, unknown> },
): RuntimeDefinition {
  const unsubscribers = new Set<() => void>();
  const bridgeState: LegacyBridgeState = { turns: new Map() };
  let closed = false;

  const transport: RuntimeTransport = {
    async createSession(opts) {
      const created = await legacy.session.create({ directory: opts.directory, parentID: opts.parentID });
      return { sessionID: String(created?.id) };
    },
    async sendTurn(input) {
      // Transport contract: sendTurn must not block on turn completion.
      void Promise.resolve(legacy.session.promptAsync({
        sessionID: input.sessionID,
        message: input.text,
        parts: input.parts,
        system: input.system,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        thinkingLevel: input.thinkingLevel,
        expectReply: input.expectReply,
        idempotencyKey: input.idempotencyKey,
      } as any)).catch(() => { /* the legacy runtime reports failures on its stream */ });
      return { turnID: input.turnID };
    },
    async interruptTurn(sessionID) {
      await legacy.session.abort({ sessionID });
    },
    async respondToRequest(sessionID, requestID, decision) {
      if (typeof legacy.session.permissionReply !== 'function') return 'unavailable';
      const reply = decision.behavior === 'answer' ? 'once' : decision.behavior === 'allow' ? (decision.always ? 'always' : 'once') : 'reject';
      await legacy.session.permissionReply(sessionID, requestID, reply, decision.message);
      return decision.behavior === 'answer' ? 'answered' : decision.behavior === 'allow' ? 'allowed-once' : 'rejected';
    },
    onEvent(listener) {
      const forward = (evt: RawRuntimeEvent) => {
        if (closed) return;
        const converted = canonicalToAdapterEvent(evt, bridgeState);
        if (converted) {
          listener(converted);
          if (converted.type === 'turn.completed' || converted.type === 'turn.failed' || converted.type === 'turn.aborted') {
            if (converted.sessionID) bridgeState.turns.delete(converted.sessionID);
          }
        }
      };
      const legacyOnEvent = (legacy as any).onEvent;
      if (typeof legacyOnEvent === 'function') {
        const unsubscribe = legacyOnEvent(forward);
        unsubscribers.add(unsubscribe);
      }
      if (legacy.global?.event) {
        let cancelled = false;
        void legacy.global.event().then(async (connection: any) => {
          const stream = connection?.stream;
          if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return;
          try {
            for await (const evt of stream) {
              if (cancelled || closed) return;
              forward(evt);
            }
          } catch {
            // stream teardown is not an error for the bridge
          }
        }).catch(() => {});
        unsubscribers.add(() => { cancelled = true; });
      }
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        unsubscribers.clear();
      };
    },
  };

  const channels: RuntimeChannels = {};
  if (legacy.tools) {
    channels.tools = {
      registerTools: (factory) => legacy.tools!.registerTools(factory as any),
      nativeTools: () => legacy.tools!.nativeTools?.() ?? [],
    };
  }
  if (legacy.session.messages) {
    channels.messages = {
      list: async (sessionID, opts) => legacy.session.messages({ sessionID, limit: opts?.limit, before: opts?.before } as any),
      ...(typeof legacy.session.normalizeMessages === 'function' ? { normalize: legacy.session.normalizeMessages as any } : {}),
    };
  }
  channels.session = {
    list: legacy.session.list ? async () => legacy.session.list!({}) : undefined,
    get: legacy.session.get ? async (sessionID) => legacy.session.get!({ sessionID }) : undefined,
    update: legacy.session.update ? async (sessionID, patch) => legacy.session.update!({ sessionID, title: patch.title ?? '' }) : undefined,
    delete: legacy.session.delete ? async (sessionID) => legacy.session.delete!({ sessionID }) : undefined,
    abort: async (sessionID) => legacy.session.abort({ sessionID }),
    listByDirectory: legacy.session.listByDirectory ? async (directory, limit) => legacy.session.listByDirectory!(directory, limit) : undefined,
  } as RuntimeChannels['session'];
  if (legacy.provider?.list) channels.providers = { list: () => legacy.provider.list() };
  if (legacy.agents) channels.agents = {
    list: async () => (legacy.agents as any).list?.() ?? [],
    install: (name, definition) => legacy.agents!.install(name, definition as any),
    remove: legacy.agents!.remove,
  };
  if (legacy.session.fork || legacy.session.revert || legacy.session.unrevert) {
    channels.branch = {
      fork: legacy.session.fork ? async (sessionID, messageID) => {
        const result = await legacy.session.fork!({ sessionID, messageID });
        return { sessionID: String(result?.id) };
      } : undefined,
      revert: legacy.session.revert ? (sessionID, messageID, opts) => legacy.session.revert!({ sessionID, messageID, files: opts?.files }) : undefined,
      unrevert: legacy.session.unrevert ? (sessionID) => legacy.session.unrevert!({ sessionID }) : undefined,
    };
  }
  if (legacy.session.diff || legacy.session.vcs) {
    channels.diff = {
      get: legacy.session.diff ? ((sessionID: string, messageID?: string) => legacy.session.diff!({ sessionID, messageID })) as any : undefined,
      vcsDiff: legacy.session.vcs?.diff ? (opts) => legacy.session.vcs!.diff!(opts) : undefined,
      vcsApply: legacy.session.vcs?.apply ? (patch) => legacy.session.vcs!.apply!({ patch }) : undefined,
    };
  }
  if (legacy.session.question) channels.question = legacy.session.question;
  if (legacy.completion) channels.completion = legacy.completion;
  if (legacy.shell) channels.shell = legacy.shell as any;
  if (legacy.mediaSession) {
    channels.mediaSession = {
      create: async (opts) => {
        const created = await legacy.mediaSession!.create({ directory: opts.directory });
        return { sessionID: String((created as any)?.id ?? (created as any)?.sessionID) };
      },
    };
  }

  const channelsV2: RuntimeChannelsV2 = {};
  if (legacy.mcp) channelsV2.mcp = legacy.mcp as unknown as RuntimeChannelsV2['mcp'];
  if (legacy.discovery) channelsV2.discovery = legacy.discovery as unknown as RuntimeChannelsV2['discovery'];
  if (legacy.session.instructions) channelsV2.instructions = legacy.session.instructions as RuntimeChannelsV2['instructions'];
  if (legacy.pty) channelsV2.pty = legacy.pty as unknown;
  if (legacy.snapshotTree) channelsV2.checkpoint = { snapshotTree: legacy.snapshotTree as any };
  if (legacy.session.background) channelsV2.background = { toBackground: (sessionID) => legacy.session.background!({ sessionID }) };

  return defineRuntime({
    api: 1,
    name: meta.name,
    displayName: meta.displayName ?? meta.name,
    preset: 'conversation',
    transport,
    channels,
    ...(Object.keys(channelsV2).length > 0 ? { channelsV2, channelApi: 2 as const } : {}),
    overrides: (meta.capabilities ?? legacy.capabilities ?? {}) as any,
  });
}
