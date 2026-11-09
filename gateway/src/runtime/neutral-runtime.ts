/**
 * Neutral runtime facade: turns a `RuntimeDefinition` (transport + channels)
 * into the `AgentRuntime` shape the gateway composition root already consumes.
 *
 * This is the only place a definition becomes a runtime. It owns:
 *  - turn id minting (the adapter echoes it, the bus fences retired turns),
 *  - the canonical event stream (bus fan-out, one iterator per consumer),
 *  - surface presence: a method exists only when the channel exists.
 */
import type { RuntimeDefinition } from '@mafw/runtime-contract';
import type {
  AgentRuntime,
  MafwToolRegistration,
  NativeToolDeclaration,
  RuntimeCapabilities,
  ThinkingLevel,
} from './contract';
import type { RawRuntimeEvent } from './normalize';
import type { DeliveredAdapterEvent, RuntimeBus } from './runtime-bus';

export interface NeutralRuntimeHost {
  config?: AgentRuntime['config'];
  completion?: AgentRuntime['completion'];
  credentials?: AgentRuntime['credentials'];
  getBaseUrl?(): string;
  healthCheck?(): Promise<boolean>;
  agentProcess?: AgentRuntime['agentProcess'];
  resolveEventEntry?(): Promise<any>;
  activeDialect?: string;
  dispose?(): Promise<void> | void;
}

export interface NeutralRuntimeOptions {
  bus: RuntimeBus;
  host?: NeutralRuntimeHost;
  now?: () => number;
  /** How long `session.prompt` waits for a terminal turn event. */
  promptTimeoutMs?: number;
}

function createBusStream(bus: RuntimeBus, runtimeName: string) {
  const queue: RawRuntimeEvent[] = [];
  let waiter: ((result: IteratorResult<RawRuntimeEvent>) => void) | null = null;
  let done = false;

  const unsubscribe = bus.subscribe((delivered: DeliveredAdapterEvent) => {
    if (delivered.runtimeName !== runtimeName) return;
    if (!delivered.canonical) return;
    const event = delivered.canonical as RawRuntimeEvent;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: event, done: false });
      return;
    }
    queue.push(event);
  });

  const finish = () => {
    done = true;
    unsubscribe();
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: undefined as unknown as RawRuntimeEvent, done: true });
    }
  };

  const iterator: AsyncIterator<RawRuntimeEvent> = {
    next() {
      if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
      if (done) return Promise.resolve({ value: undefined as unknown as RawRuntimeEvent, done: true });
      return new Promise((resolve) => { waiter = resolve; });
    },
    return() {
      finish();
      return Promise.resolve({ value: undefined as unknown as RawRuntimeEvent, done: true });
    },
  };

  return {
    stream: { [Symbol.asyncIterator]: () => iterator },
    close: finish,
  };
}

export function createNeutralRuntime(
  definition: RuntimeDefinition,
  options: NeutralRuntimeOptions,
): AgentRuntime {
  const { transport, channels = {}, channelsV2 = {} } = definition;
  // Definition-declared host surfaces win over composition-root defaults
  // (e.g. an adapter's live serve URL must beat the gateway API port).
  const host: NeutralRuntimeHost = { ...(options.host ?? {}), ...(definition.host as any) };
  const bus = options.bus;
  const now = options.now ?? Date.now;
  const promptTimeoutMs = options.promptTimeoutMs ?? 600_000;
  const streams = new Set<() => void>();

  let turnSeq = 0;
  const mintTurnID = (): string => {
    turnSeq += 1;
    return `turn_${now().toString(36)}_${turnSeq}`;
  };

  const runtime: Record<string, any> = {
    name: definition.name,
    capabilities: definition.capabilities as RuntimeCapabilities,
    external: definition.external,
    semantics: (definition as any).semantics,

    session: {
      async create(opts: any) {
        const created = await transport.createSession({
          directory: opts.directory,
          parentID: opts.parentID,
          title: opts.title,
        });
        return { id: created.sessionID };
      },
      async promptAsync(opts: any) {
        const turnID = mintTurnID();
        await transport.sendTurn({
          sessionID: opts.sessionID,
          turnID,
          text: opts.message ?? opts.text ?? '',
          parts: opts.parts,
          system: opts.system,
          agent: opts.agent,
          model: opts.model,
          variant: opts.variant,
          thinkingLevel: opts.thinkingLevel,
          delivery: opts.delivery,
          expectReply: opts.expectReply,
          idempotencyKey: opts.idempotencyKey,
          outputSchema: opts.outputSchema,
          budget: opts.maxTurns || opts.maxCostUsd
            ? { maxTurns: opts.maxTurns, maxCostUsd: opts.maxCostUsd }
            : undefined,
        });
      },
      async prompt(opts: any) {
        const turnID = mintTurnID();
        const parts: any[] = [];
        const textChunks: string[] = [];
        let usage: unknown;
        let finish: unknown;
        let failure: string | undefined;
        let settle: (() => void) | undefined;
        const settled = new Promise<void>((resolve) => { settle = resolve; });

        const unsubscribe = bus.subscribe((delivered) => {
          if (delivered.runtimeName !== definition.name || !delivered.canonical) return;
          const payload: any = (delivered.canonical as any).payload ?? {};
          const props: any = payload.properties ?? {};
          const sessionID = props.sessionID ?? (delivered.canonical as any).sessionID;
          if (sessionID && sessionID !== opts.sessionID) return;
          if (payload.type === 'part.updated' && props.part) parts.push(props.part);
          if (payload.type === 'message.updated' && props.message?.role === 'assistant') {
            const content = Array.isArray(props.message.parts)
              ? props.message.parts
              : Array.isArray(props.message.content) ? props.message.content : [];
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                parts.push(block);
                textChunks.push(block.text);
              }
            }
          }
          if (payload.type === 'part.delta' && props.field === 'text' && typeof props.delta === 'string') {
            textChunks.push(props.delta);
          }
          if (props.turnID !== turnID) return;
          if (payload.type === 'turn.completed') {
            usage = props.usage ?? usage;
            finish = props.stopReason ?? payload.type;
            settle?.();
          } else if (payload.type === 'turn.failed') {
            failure = String(props.error ?? 'turn failed');
            settle?.();
          } else if (payload.type === 'turn.aborted') {
            failure = 'aborted';
            settle?.();
          }
        });

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await transport.sendTurn({
            sessionID: opts.sessionID,
            turnID,
            text: opts.message ?? opts.text ?? '',
            parts: opts.parts,
            system: opts.system,
            agent: opts.agent,
            model: opts.model,
            variant: opts.variant,
            thinkingLevel: opts.thinkingLevel,
            delivery: opts.delivery,
            expectReply: opts.expectReply,
            idempotencyKey: opts.idempotencyKey,
            outputSchema: opts.outputSchema,
          });
          const timeout = new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`turn timeout after ${promptTimeoutMs}ms`)), promptTimeoutMs);
            timer.unref?.();
          });
          await Promise.race([settled, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
          unsubscribe();
        }

        return { parts, text: textChunks.join(''), finish, usage, ...(failure ? { error: failure } : {}) };
      },
      async abort(opts: any) {
        await transport.interruptTurn(opts.sessionID);
      },
    },

    global: {
      async event() {
        const busStream = createBusStream(bus, definition.name);
        streams.add(busStream.close);
        return { stream: busStream.stream };
      },
    },
  };

  // Optional session surfaces: presence mirrors the channel.
  const session = runtime.session;
  if (channels.messages) {
    session.messages = async (opts: any) => {
      const result = await channels.messages!.list(opts.sessionID, { limit: opts.limit, before: opts.before });
      const data = channels.messages!.normalize && Array.isArray(result?.data)
        ? channels.messages!.normalize(result.data)
        : result?.data;
      return { ...result, data };
    };
  }
  if (channels.session?.get) session.get = (opts: any) => channels.session!.get!(opts.sessionID);
  if (channels.session?.list) session.list = (opts?: any) => channels.session!.list!(opts);
  if (channels.session?.listByDirectory) {
    session.listByDirectory = (directory: string, limit?: number) => channels.session!.listByDirectory!(directory, limit);
  }
  if (channels.session?.update) session.update = (opts: any) => channels.session!.update!(opts.sessionID, { title: opts.title });
  if (channels.session?.delete) session.delete = (opts: any) => channels.session!.delete!(opts.sessionID);
  if (channels.session?.todo) session.todo = (opts: any) => channels.session!.todo!(opts.sessionID);
  if (channels.session?.children) session.children = (opts: any) => channels.session!.children!(opts.sessionID);
  if (channels.session?.summarize) session.summarize = (opts: any) => channels.session!.summarize!(opts);
  if (channels.session?.switchAgent) session.switchAgent = (opts: any) => channels.session!.switchAgent!(opts.sessionID, opts.agent);
  if (channels.session?.switchModel) session.switchModel = (opts: any) => channels.session!.switchModel!(opts.sessionID, opts.model);
  if (channels.session?.setThinkingLevel) {
    session.setThinkingLevel = (opts: { sessionID: string; level: ThinkingLevel }) =>
      channels.session!.setThinkingLevel!(opts.sessionID, opts.level);
  }
  if (channels.session?.permissionList) session.permissionList = (opts?: any) => channels.session!.permissionList!(opts);
  if (channels.session?.background) session.background = (opts: any) => channels.session!.background!(opts.sessionID);
  else if (channelsV2.background?.toBackground) {
    session.background = (opts: any) => channelsV2.background!.toBackground!(opts.sessionID);
  }
  if (channels.branch?.fork) {
    session.fork = async (opts: any) => {
      const created = await channels.branch!.fork!(opts.sessionID, opts.messageID);
      return { id: created.sessionID };
    };
  }
  if (channels.branch?.revert) {
    session.revert = (opts: any) => channels.branch!.revert!(opts.sessionID, opts.messageID, { files: opts.files });
  }
  if (channels.branch?.unrevert) session.unrevert = (opts: any) => channels.branch!.unrevert!(opts.sessionID);
  if (channels.diff?.get) session.diff = (opts: any) => channels.diff!.get!(opts.sessionID, opts.messageID);
  if (channels.diff?.vcsDiff || channels.diff?.vcsApply) {
    session.vcs = {
      ...(channels.diff?.vcsDiff ? { diff: (opts?: any) => channels.diff!.vcsDiff!(opts) } : {}),
      ...(channels.diff?.vcsApply ? { apply: (opts: any) => channels.diff!.vcsApply!(opts.patch) } : {}),
    };
  }
  if (channels.question) {
    session.question = {
      list: (opts?: any) => channels.question!.list(opts),
      reply: (opts: any) => channels.question!.reply(opts),
      reject: (opts: any) => channels.question!.reject(opts),
    };
  }
  if (channelsV2.instructions) {
    session.instructions = {
      list: (sessionID: string, opts?: any) => channelsV2.instructions!.list(sessionID),
      put: (sessionID: string, key: string, value: unknown) => channelsV2.instructions!.put(sessionID, key, value),
      remove: (sessionID: string, key: string) => channelsV2.instructions!.remove(sessionID, key),
    };
  }
  if (transport.respondToRequest) {
    session.permissionReply = async (sessionID: string, requestID: string, reply: string, message?: string) => {
      const decision = reply === 'reject'
        ? { behavior: 'deny' as const, message }
        : reply === 'always'
          ? { behavior: 'allow' as const, always: true, message }
          : { behavior: 'allow' as const, message };
      const outcome = await transport.respondToRequest!(sessionID, requestID, decision);
      return outcome === 'allowed-once' || outcome === 'answered';
    };
  }

  if (channels.shell) {
    runtime.shell = {
      create: (opts: any) => channels.shell!.create({ command: opts.command, cwd: opts.cwd, timeout: opts.timeout }),
      get: (opts: any) => channels.shell!.get(opts.shellID),
      output: (opts: any) => channels.shell!.output(opts.shellID, { cursor: opts.cursor, limit: opts.limit }),
      remove: (opts: any) => channels.shell!.remove(opts.shellID),
    };
  }
  if (channels.providers) runtime.provider = { list: () => channels.providers!.list() };
  if (channels.agents) runtime.app = { agents: () => channels.agents!.list() };
  if (channels.agents) {
    runtime.agents = {
      install: (name: string, value: unknown) => channels.agents!.install(name, value),
      ...(channels.agents.remove ? { remove: (name: string) => channels.agents!.remove!(name) } : {}),
    };
  }
  if (channels.completion) runtime.completion = channels.completion;
  if (channels.mediaSession) {
    runtime.mediaSession = {
      create: async (opts: any) => {
        const created = await channels.mediaSession!.create({ directory: opts.directory });
        return { id: created.sessionID };
      },
    };
  }
  if (channels.tools) {
    runtime.tools = {
      registerTools: (factory: (sessionID: string) => MafwToolRegistration[]) => channels.tools!.registerTools(factory),
      nativeTools: () => (channels.tools!.nativeTools?.() ?? []) as NativeToolDeclaration[],
    };
  }
  if (channelsV2.mcp) runtime.mcp = channelsV2.mcp;
  if (channelsV2.discovery) runtime.discovery = channelsV2.discovery;
  if (channelsV2.pty) runtime.pty = channelsV2.pty;
  if (channelsV2.checkpoint) runtime.snapshotTree = channelsV2.checkpoint;

  if (host.config) runtime.config = host.config;
  if (host.credentials) runtime.credentials = host.credentials;
  if (host.completion) runtime.completion = host.completion;
  if (host.getBaseUrl) runtime.getBaseUrl = host.getBaseUrl;
  if (host.healthCheck) runtime.healthCheck = host.healthCheck;
  if (host.agentProcess) runtime.agentProcess = host.agentProcess;
  if (host.activeDialect) runtime.activeDialect = host.activeDialect;
  if (host.resolveEventEntry) runtime.resolveEventEntry = host.resolveEventEntry;

  runtime.rewireEvents = async () => {
    for (const close of [...streams]) close();
    streams.clear();
    return 'neutral';
  };

  runtime.dispose = async () => {
    for (const close of [...streams]) close();
    streams.clear();
    await transport.stop?.();
    await host.dispose?.();
  };

  return runtime as AgentRuntime;
}
