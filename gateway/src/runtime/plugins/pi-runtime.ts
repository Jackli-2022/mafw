import type { AgentRuntime, RuntimeCapabilities } from '../contract';
import type { RuntimePluginContext } from '../loader';
import { PiSessionRegistry } from '../pi/pi-session';
import { translatePiMessages } from '../pi/pi-messages';
import { PiEventStream } from '../pi/pi-events';
import { translateProviders, translateAgents, translateConfigGet, translateConfigUpdate } from '../pi/pi-provider';
import { DEFAULT_AUTH_PATH, readOpencodeAuth } from '../../media/auth-util';
import { config } from '../../config';
import { listByDirectory } from '../pi/pi-session-storage';
import * as piAgentConfig from '../pi/pi-agent-config';

export const PI_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: true,
  promptWhileBusy: true,
  eventStream: true,
  nativeApprovals: true,
  providerConfigApi: true,
  perLlmCallTransform: true,
  sessionStorageApi: true,
  agentConfigApi: true,
};

export interface PiRuntimeDeps {
  loadPi?: () => Promise<any>;
  authPath?: string;
  timeoutMs?: number;
}

export async function createPiRuntime(ctx: RuntimePluginContext, deps: PiRuntimeDeps = {}): Promise<AgentRuntime> {
  const authPath = deps.authPath ?? DEFAULT_AUTH_PATH();
  const cfg = ctx.pluginConfig('pi');
  const provider = cfg.provider ?? 'xiaomi';
  const modelID = cfg.model ?? 'mimo-v2.5';
  const thinkingLevel = cfg.thinkingLevel ?? 'medium';

  const imp = deps.loadPi ?? (new Function('spec', 'return import(spec)') as (s: string) => Promise<any>);

  let mrPromise: Promise<any> | undefined;
  function modelRuntime(): Promise<any> {
    if (!mrPromise) {
      mrPromise = (async () => {
        const { ModelRuntime } = await imp('@earendil-works/pi-coding-agent');
        const mr = await ModelRuntime.create({ signal: AbortSignal.timeout(30_000) });
        const key = ctx.credentials?.getApiKey?.(provider) ?? readOpencodeAuth(authPath)[provider]?.key;
        if (key) await mr.setRuntimeApiKey(provider, key);
        return mr;
      })();
      mrPromise.catch(() => { mrPromise = undefined; });
    }
    return mrPromise;
  }

  const eventStream = new PiEventStream((session: any) => undefined);
  const registry = new PiSessionRegistry({
    createSession: async (opts: any) => {
      const { createAgentSession } = await imp('@earendil-works/pi-coding-agent');
      const mr = await modelRuntime();
      const model = mr.getModel(opts.model?.provider ?? provider, opts.model?.modelID ?? modelID);
      const { session } = await createAgentSession({
        cwd: opts.cwd,
        modelRuntime: mr,
        model,
        thinkingLevel,
      });
      eventStream.trackSession(session);
      return { session };
    },
  }, { sessionTtlMs: cfg.sessionTtlMs, emitEvent: (evt) => eventStream.push(evt), policy: cfg.approvalPolicy });

  const sessionAPI = {
    create: async (opts: { directory?: string }) => {
      const { id } = await registry.create(opts?.directory ?? config.raw.paths.projectDir, { model: { provider, modelID } });
      return { id };
    },
    promptAsync: async (opts: { sessionID: string; message?: string; parts?: any[] }) => {
      const text = opts.message ?? (opts.parts || []).map((p: any) => p.text || '').join('\n');
      await registry.promptAsync(opts.sessionID, text);
    },
    prompt: async (opts: { sessionID: string; message?: string; parts?: any[] }) => {
      const text = opts.message ?? (opts.parts || []).map((p: any) => p.text || '').join('\n');
      return registry.prompt(opts.sessionID, text);
    },
    messages: async (opts: { sessionID: string }) => {
      const { data } = await registry.messages(opts.sessionID);
      return { data: translatePiMessages(data, opts.sessionID), nextCursor: undefined };
    },
    get: async (opts: { sessionID: string }) => registry.get(opts.sessionID),
    delete: async (opts: { sessionID: string }) => { await registry.delete(opts.sessionID); },
    abort: async (opts: { sessionID: string }) => { await registry.abort(opts.sessionID); },
    list: async () => registry.list(),
    todo: async () => registry.todo(),
    children: async () => registry.children(),
    summarize: async (opts: { sessionID: string }) => registry.summarize(opts.sessionID),
    listByDirectory: async (directory: string, limit?: number) => {
      return listByDirectory(directory, limit);
    },
    permissionReply: (sessionID: string, requestId: string, approved: boolean) =>
      registry.permissionReply(sessionID, requestId, approved),
  };

  return {
    name: 'pi',
    capabilities: PI_CAPABILITIES,
    external: true,
    session: sessionAPI,
    global: { event: () => Promise.resolve({ stream: eventStream.stream() }) },
    provider: { list: () => modelRuntime().then((mr) => translateProviders(mr)) },
    app: { agents: () => translateAgents() },
    config: { get: () => translateConfigGet(), update: (c: any) => translateConfigUpdate(c) },
    credentials: { getApiKey: (p: string) => ctx.credentials?.getApiKey?.(p) ?? readOpencodeAuth(authPath)[p]?.key ?? null },
    agents: {
      install: async (name: string, definition: any) => {
        await piAgentConfig.install(name, definition);
      },
      remove: async (name: string) => {
        await piAgentConfig.remove(name);
      },
      list: async () => {
        return piAgentConfig.list();
      },
      get: async (name: string) => {
        return piAgentConfig.get(name);
      },
    },
    registry,
    getBaseUrl: () => `http://127.0.0.1:${config.server.apiPort ?? 3000}`,
    healthCheck: async () => { try { await modelRuntime(); return true; } catch { return false; } },
    dispose: async () => {
      await registry.disposeAll();
      await eventStream.dispose();
    },
  } as AgentRuntime;
}