/**
 * Generic adapter bridge: wraps a `RuntimeClient`-shaped runtime (old plugin
 * `createRuntime`, or an in-process builtin) into a neutral `RuntimeDefinition`.
 *
 * The bridge is generic (no runtime names). It reverse-maps canonical
 * envelopes back to `AdapterEvent`, which the bus then maps forward again —
 * one canonical seam, two directions, pinned by the round-trip test.
 *
 * `translate` is for runtimes whose native stream is not yet canonical
 * (opencode dialects): the bridge applies the declared event mappings first.
 */
import { defineRuntime, validateAdapterEvent, type AdapterEvent, type RuntimeChannels, type RuntimeChannelsV2, type RuntimeDefinition, type RuntimeTransport } from '@mafw/runtime-contract';
import { log } from '../core/utils/logger';
import type { AgentRuntime } from './contract';
import type { EventMappingEntry, TranslationHooks } from './event-mapper';
import { applyEventMappings } from './event-mapper';
import type { RawRuntimeEvent } from './normalize';

let sequence = 0;
function nextID(): string {
  sequence += 1;
  return `bridge-${Date.now().toString(36)}-${sequence}`;
}

/** AdapterEvent types that require a turnID (validateAdapterEvent contract). */
function nativeNeedsTurn(type: string): boolean {
  return type.startsWith('turn.') || type === 'usage.updated' || type.startsWith('tool.');
}

const nativeDropWarned = new Set<string>();
function warnNativeDrop(type: string, reason: string): void {
  const key = `${type}:${reason}`;
  if (nativeDropWarned.has(key)) return;
  nativeDropWarned.add(key);
  log.warn(`[AdapterBridge] dropped native ${key}`);
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

export interface AdapterBridgeState {
  turns: Map<string, string>;
}

/** Reverse-map a canonical envelope to AdapterEvent for the runtime event set. */
export function canonicalToAdapterEvent(
  evt: RawRuntimeEvent,
  state: AdapterBridgeState = { turns: new Map() },
  overrideTurnID?: string,
): AdapterEvent | null {
  const type = typeOf(evt);
  const props = propsOf(evt);
  const sessionID = sessionOf(evt, props);
  if (!type) return null;
  let turnID = overrideTurnID ?? (typeof props.turnID === 'string' ? props.turnID : (sessionID ? state.turns.get(sessionID) : undefined));
  if (
    type === 'turn.started' || type === 'usage.updated'
    || type === 'tool.call' || type === 'tool.delta' || type === 'tool.result'
    || (type.startsWith('turn.') && !turnID)
  ) {
    turnID = turnID ?? `bridge-${sessionID ?? 'session'}-${nextID()}`;
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
    case 'session.created': {
      // @2.1 emits a flat `data` payload (no `properties.info`); keep the
      // session identifiable either way instead of dropping the event.
      const info = props.info && typeof props.info === 'object' ? props.info : props;
      const id = info.id ?? props.sessionID;
      return make('session.created', { session: { ...info, ...(id ? { id } : {}) } });
    }
    case 'session.updated': return make('session.updated', { patch: props.info });
    case 'session.deleted': return make('session.deleted', {});
    case 'session.compacting': return make('session.compacting', {});
    case 'session.compacted': return make('session.compacted', {});
    case 'turn.started': return make('turn.started', {});
    case 'turn.completed': return make('turn.completed', { ok: props.ok !== false, stopReason: props.stopReason, usage: props.usage, costUsd: props.cost });
    case 'turn.failed': return make('turn.failed', {
      error: { kind: 'unknown', message: String(props.error?.message ?? props.error ?? 'runtime error') },
      retryable: props.retryable,
    });
    case 'turn.aborted': return make('turn.aborted', { reason: props.reason });
    case 'turn.retrying': return make('turn.retrying', { attempt: props.attempt, delayMs: props.delayMs, reason: props.reason });
    case 'turn.waiting': return make('turn.waiting', { reason: props.reason });
    case 'turn.cap_exhausted': return make('turn.cap_exhausted', { reason: props.reason });
    case 'message.updated': return make('message.updated', { message: props.message });
    case 'message.removed': return make('message.removed', { messageID: props.messageID ?? props.message?.id });
    case 'part.updated': return make('part.updated', { part: props.part });
    case 'part.delta': return make('part.delta', { messageID: props.messageID, partID: props.partID, field: props.field, delta: props.delta });
    case 'part.complete': return make('part.completed', { part: props.part });
    case 'part.removed': return make('part.removed', { partID: props.partID ?? props.part?.id });
    case 'permission.asked': return make('permission.asked', { request: props });
    case 'permission.replied': return make('permission.replied', { reply: props.reply ?? (props.approved ? 'once' : 'reject'), source: props.source ?? 'user', message: props.message });
    case 'question.asked': return make('question.asked', { request: props });
    case 'question.replied': return make('question.replied', { answers: props.answers });
    case 'question.rejected': return make('question.rejected', {});
    case 'plan.updated': return make('plan.updated', { items: props.todos ?? props.items ?? props });
    case 'usage.updated': return make('usage.updated', { usage: props.usage ?? props, contextTokens: props.contextTokens, contextWindow: props.contextWindow });
    case 'background.job.updated': return make('background.job.updated', { job: props.job });
    case 'queue.updated': return make('queue.updated', {
      items: Array.isArray(props.items) ? props.items : [],
      ...(props.action ? { action: props.action } : {}),
      ...(props.item ? { item: props.item } : {}),
      ...(props.id ? { id: props.id } : {}),
    });
    case 'session.diff': return make('session.diff', { messageID: props.messageID, diff: props.diff ?? [] });
    case 'tool.call': return make('tool.call', { callID: props.callID, name: props.tool ?? props.name, input: props.input ?? {}, title: props.title });
    case 'tool.delta': return make('tool.delta', { callID: props.callID, field: props.kind ?? props.field, delta: props.text ?? props.delta });
    case 'tool.result': return make('tool.result', {
      callID: props.callID,
      ok: props.isError !== true,
      output: props.output,
      ...(props.error ? { error: props.error } : {}),
    });
    case 'runtime.notice': return make('runtime.notice', { level: props.level ?? 'info', message: props.message ?? '' });
    default: return null;
  }
}

const bridgeEntries = new Map<string, EventMappingEntry>();

/** Event-translation declaration registered by a bridged definition (dry-event/audit tooling). */
export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return bridgeEntries.get(name);
}

/** Update the tooling entry after a deferred dialect probe resolves. */
export function setBridgeEventEntry(name: string, entry: EventMappingEntry): void {
  bridgeEntries.set(name, entry);
}

export interface AdapterBridgeMeta {
  name: string;
  displayName?: string;
  capabilities?: Record<string, unknown>;
  /** true = gateway must not spawn/kill the underlying process. */
  external?: boolean;
  /**
   * Dialect translation applied before reverse-mapping: for runtimes whose
   * native stream is still raw (opencode v1/v2/v21). `entryResolver` defers
   * resolution until the first event (cold start: the serve may not exist yet).
   */
  translate?: {
    entry?: EventMappingEntry;
    entryResolver?: () => Promise<EventMappingEntry>;
    isCanonical: (type: string) => boolean;
    hooks?: TranslationHooks;
  };
  /** Notification when a deferred entry resolves (diagnostics/activeDialect). */
  onEntryResolved?: (entry: EventMappingEntry) => void;
  /** Tooling key when it differs from the runtime name (dry-event/conformance). */
  entryAlias?: string;
  /** true = the runtime's global.event() already yields AdapterEvent v1. */
  nativeEvents?: boolean;
}

export function toRuntimeDefinition(
  legacy: AgentRuntime,
  meta: AdapterBridgeMeta,
): RuntimeDefinition {
  if (meta.nativeEvents && meta.translate) {
    throw new Error('toRuntimeDefinition: nativeEvents and translate are mutually exclusive');
  }
  const unsubscribers = new Set<() => void>();
  const bridgeState: AdapterBridgeState = { turns: new Map() };
  /**
   * Gateway-minted turn ids per session. Pi queues prompts, so ids must be
   * promoted one at a time: the next id becomes active only on `turn.started`,
   * otherwise a busy follow-up would relabel the running turn's terminal.
   */
  const pendingTurns = new Map<string, string[]>();
  const activeTurns = new Map<string, string>();
  const listeners = new Set<(evt: AdapterEvent) => void>();
  let closed = false;

  const emitFailure = (sessionID: string, turnID: string | undefined, message: string) => {
    const event: AdapterEvent = {
      id: `bridge_fail_${Date.now().toString(36)}`,
      type: 'turn.failed',
      sessionID,
      ...(turnID ? { turnID } : {}),
      at: Date.now(),
      data: { error: { kind: 'unknown', message }, retryable: false },
    } as AdapterEvent;
    for (const listener of listeners) listener(event);
  };

  const transport: RuntimeTransport = {
    async createSession(opts) {
      const created = await legacy.session.create({ directory: opts.directory, parentID: opts.parentID });
      return { sessionID: String((created as any)?.id ?? (created as any)?.sessionID) };
    },
    async sendTurn(input) {
      // Transport contract: sendTurn must not block on turn completion.
      // The minted turn id is echoed on every turn-scoped event by the bridge.
      const queue = pendingTurns.get(input.sessionID) ?? [];
      queue.push(input.turnID);
      pendingTurns.set(input.sessionID, queue);
      void Promise.resolve(legacy.session.promptAsync({
        sessionID: input.sessionID,
        message: input.text,
        parts: input.parts,
        system: input.system,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        thinkingLevel: input.thinkingLevel,
        delivery: input.delivery,
        expectReply: input.expectReply,
        idempotencyKey: input.idempotencyKey,
      } as any)).catch((err: any) => {
        // Surface the failure on the stream instead of swallowing it.
        const queueNow = pendingTurns.get(input.sessionID) ?? [];
        const index = queueNow.indexOf(input.turnID);
        if (index >= 0) queueNow.splice(index, 1);
        emitFailure(input.sessionID, input.turnID, String(err?.message ?? err));
      });
      return { turnID: input.turnID };
    },
    async interruptTurn(sessionID) {
      await legacy.session.abort({ sessionID });
      activeTurns.delete(sessionID);
    },
    async respondToRequest(sessionID, requestID, decision) {
      if (typeof legacy.session.permissionReply !== 'function') return 'unavailable';
      const reply = decision.behavior === 'answer' ? 'once' : decision.behavior === 'allow' ? (decision.always ? 'always' : 'once') : 'reject';
      await legacy.session.permissionReply(sessionID, requestID, reply, decision.message);
      return decision.behavior === 'answer' ? 'answered' : decision.behavior === 'allow' ? 'allowed-once' : 'rejected';
    },
    async stop() {
      closed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.clear();
      await (legacy as any).dispose?.();
    },
    onEvent(listener) {
      const translate = meta.translate;
      let resolvedEntry: EventMappingEntry | undefined = translate?.entryResolver ? undefined : translate?.entry;
      let resolving: Promise<EventMappingEntry> | undefined;
      let buffer: RawRuntimeEvent[] = [];
      // Exposed for the neutral facade's rewireEvents (serve recovery may
      // change the dialect; the next event re-probes).
      (transport as any).rewire = () => { resolvedEntry = translate?.entryResolver ? undefined : translate?.entry; resolving = undefined; buffer = []; };

      const translateOne = (entry: EventMappingEntry, evt: RawRuntimeEvent) =>
        applyEventMappings(evt, entry, meta.translate!.isCanonical, meta.translate!.hooks);

      const pump = (evt: RawRuntimeEvent) => {
        if (resolvedEntry) return translateOne(resolvedEntry, evt);
        // Defer translation until the dialect resolver settles (cold start:
        // the serve may not exist when the definition is built).
        buffer.push(evt);
        if (!resolving && translate?.entryResolver) {
          resolving = translate.entryResolver().then((entry) => {
            resolvedEntry = entry;
            meta.onEntryResolved?.(entry);
            const pending = buffer;
            buffer = [];
            for (const item of pending) forwardTranslated(translateOne(entry, item));
            return entry;
          }).catch(() => {
            // Never leave the stream buffering forever: fall back to the static
            // entry (v1 fail-safe) and re-arm the resolver for the next event.
            const fallback = meta.translate?.entry;
            resolvedEntry = fallback;
            resolving = undefined;
            const pending = buffer;
            buffer = [];
            if (fallback) for (const item of pending) forwardTranslated(translateOne(fallback, item));
            return fallback as unknown as EventMappingEntry;
          });
        }
        return [] as RawRuntimeEvent[];
      };

      const forwardTranslated = (translated: RawRuntimeEvent[]) => {
        if (closed) return;
        for (const item of translated) {
          const sessionHint = sessionOf(item, propsOf(item));
          if (sessionHint && typeOf(item) === 'turn.started') {
            const queue = pendingTurns.get(sessionHint);
            const next = queue?.shift();
            if (next) activeTurns.set(sessionHint, next);
            if (queue && queue.length === 0) pendingTurns.delete(sessionHint);
          }
          const overrideTurnID = sessionHint
            ? (activeTurns.get(sessionHint) ?? pendingTurns.get(sessionHint)?.[0])
            : undefined;
          const converted = canonicalToAdapterEvent(item, bridgeState, overrideTurnID);
          if (!converted) continue;
          listener(converted);
          if (converted.type === 'turn.completed' || converted.type === 'turn.failed' || converted.type === 'turn.aborted') {
            if (!converted.sessionID) continue;
            bridgeState.turns.delete(converted.sessionID);
            // Runtimes without a turn.started event never advance the queue on
            // start; consume the head id on the terminal so the next turn gets
            // its own (otherwise it would reuse a retired id and be dropped).
            if (activeTurns.has(converted.sessionID)) {
              activeTurns.delete(converted.sessionID);
            } else {
              const queue = pendingTurns.get(converted.sessionID);
              queue?.shift();
              if (queue && queue.length === 0) pendingTurns.delete(converted.sessionID);
            }
          }
        }
      };

      const forwardNative = (input: unknown) => {
        if (closed || !input || typeof input !== 'object') return;
        const evt = input as AdapterEvent;
        const sessionHint = evt.sessionID;
        if (sessionHint && evt.type === 'turn.started') {
          const queue = pendingTurns.get(sessionHint);
          const next = queue?.shift();
          if (next) activeTurns.set(sessionHint, next);
          if (queue && queue.length === 0) pendingTurns.delete(sessionHint);
        }
        const active = sessionHint ? activeTurns.get(sessionHint) : undefined;
        const bridged = sessionHint ? bridgeState.turns.get(sessionHint) : undefined;
        const queued = sessionHint ? pendingTurns.get(sessionHint)?.[0] : undefined;
        let overrideTurnID = active ?? bridged ?? queued;
        if (sessionHint && !overrideTurnID && nativeNeedsTurn(evt.type)) {
          // An extension/restarted run may not have gone through sendTurn; mint
          // one rather than losing the terminal or tool frames.
          overrideTurnID = `bridge-${sessionHint}-${nextID()}`;
          bridgeState.turns.set(sessionHint, overrideTurnID);
        }
        if (sessionHint && evt.type === 'turn.started' && overrideTurnID) {
          bridgeState.turns.set(sessionHint, overrideTurnID);
        }
        const withTurnID = overrideTurnID && !evt.turnID ? { ...evt, turnID: overrideTurnID } : evt;
        const validation = validateAdapterEvent(withTurnID);
        if (!validation.ok) {
          warnNativeDrop(String(evt.type), validation.errors.join('; '));
          return;
        }
        listener(validation.event);
        if (validation.event.type === 'turn.completed' || validation.event.type === 'turn.failed' || validation.event.type === 'turn.aborted') {
          const sid = validation.event.sessionID;
          if (!sid) return;
          bridgeState.turns.delete(sid);
          if (activeTurns.has(sid)) {
            activeTurns.delete(sid);
          } else if (!bridged) {
            // Terminal was attributed to the queue head; consume it. When the
            // bridge fallback supplied the id, the queued turn is the NEXT one
            // and must not lose its start.
            const queue = pendingTurns.get(sid);
            queue?.shift();
            if (queue && queue.length === 0) pendingTurns.delete(sid);
          }
        }
      };

      const forward = (evt: RawRuntimeEvent) => {
        if (closed) return;
        if (meta.nativeEvents) return forwardNative(evt);
        if (!translate) return forwardTranslated([evt]);
        const immediate = pump(evt);
        if (immediate.length > 0) forwardTranslated(immediate);
      };
      listeners.add(listener);
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
        listeners.delete(listener);
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
    todo: legacy.session.todo ? async (sessionID) => legacy.session.todo!({ sessionID }) : undefined,
    children: legacy.session.children ? async (sessionID) => legacy.session.children!({ sessionID }) : undefined,
    summarize: legacy.session.summarize ? async (input) => legacy.session.summarize!(input) : undefined,
    switchAgent: legacy.session.switchAgent ? async (sessionID, agent) => legacy.session.switchAgent!({ sessionID, agent }) : undefined,
    switchModel: legacy.session.switchModel ? async (sessionID, model) => legacy.session.switchModel!({ sessionID, model, variant: model.variant }) : undefined,
    setThinkingLevel: legacy.session.setThinkingLevel
      ? async (sessionID, level) => legacy.session.setThinkingLevel!({ sessionID, level })
      : undefined,
    permissionList: legacy.session.permissionList
      ? async (opts) => legacy.session.permissionList!(opts)
      : undefined,
    background: legacy.session.background
      ? async (sessionID) => legacy.session.background!({ sessionID })
      : undefined,
  } as RuntimeChannels['session'];
  if (legacy.provider?.list) channels.providers = { list: () => legacy.provider.list() };
  if (legacy.agents || legacy.app?.agents) channels.agents = {
    list: async () => legacy.app?.agents ? legacy.app.agents() : ((legacy.agents as any)?.list?.() ?? []),
    install: (name, definition) => legacy.agents!.install(name, definition as any),
    remove: legacy.agents?.remove,
  };
  if (legacy.session.fork || legacy.session.revert || legacy.session.unrevert) {
    channels.branch = {
      fork: legacy.session.fork ? async (sessionID, messageID) => {
        const result = await legacy.session.fork!({ sessionID, messageID });
        return { sessionID: String((result as any)?.id ?? (result as any)?.sessionID) };
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
  const entryForTooling = meta.translate?.entry;
  if (entryForTooling) {
    bridgeEntries.set(meta.name, entryForTooling);
    if (meta.entryAlias) bridgeEntries.set(meta.entryAlias, entryForTooling);
  }
  if (legacy.mcp) channelsV2.mcp = legacy.mcp as unknown as RuntimeChannelsV2['mcp'];
  if (legacy.discovery) channelsV2.discovery = legacy.discovery as unknown as RuntimeChannelsV2['discovery'];
  if (legacy.session.instructions) channelsV2.instructions = legacy.session.instructions as RuntimeChannelsV2['instructions'];
  if (legacy.pty) channelsV2.pty = legacy.pty as unknown as RuntimeChannelsV2['pty'];
  if (legacy.snapshotTree) channelsV2.checkpoint = { locate: (opts) => legacy.snapshotTree!.locate(opts) };
  if (legacy.session.background) channelsV2.background = { toBackground: (sessionID) => legacy.session.background!({ sessionID }) };

  return defineRuntime({
    api: 1,
    name: meta.name,
    displayName: meta.displayName ?? meta.name,
    preset: 'conversation',
    transport,
    channels,
    ...(meta.external !== undefined ? { external: meta.external } : {}),
    ...(legacy.semantics ? { semantics: legacy.semantics } : {}),
    // Always carry a host block: adapters attach activeDialect/agentProcess at
    // creation time, and the composition root reads it for diagnostics.
    host: {
      ...(legacy.config ? { config: legacy.config } : {}),
      ...(legacy.credentials ? { credentials: legacy.credentials } : {}),
      ...(legacy.completion ? { completion: legacy.completion } : {}),
      ...(typeof legacy.healthCheck === 'function' ? { healthCheck: legacy.healthCheck.bind(legacy) } : {}),
      ...(typeof legacy.getBaseUrl === 'function' ? { getBaseUrl: legacy.getBaseUrl.bind(legacy) } : {}),
      ...(legacy.agentProcess ? { agentProcess: legacy.agentProcess } : {}),
      ...(legacy.activeDialect ? { activeDialect: legacy.activeDialect } : {}),
    },
    ...(Object.keys(channelsV2).length > 0 ? { channelsV2, channelApi: 2 as const } : {}),
    overrides: (meta.capabilities ?? legacy.capabilities ?? {}) as any,
  });
}
