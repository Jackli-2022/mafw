import type { AgentRuntime, RuntimeCapabilities, CompletionRequest, CompletionResult } from '../contract';
import type { RuntimePluginContext } from '../loader';
import { PiSessionRegistry } from '../pi/pi-session';
import { translatePiMessages } from '../pi/pi-messages';
import { PiEventStream } from '../pi/pi-events';
import { translateProviders, translateAgents, translateConfigGet, translateConfigUpdate } from '../pi/pi-provider';
import { DEFAULT_AUTH_PATH, readOpencodeAuth } from '../auth';
import { config } from '../../config';
import { listByDirectory } from '../pi/pi-session-storage';
import { fixMediaPayload } from '../../media/pi-adapter';
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
  completionApi: true,
};

/**
 * Convert runtime prompt parts into pi prompt input. File parts carrying
 * image data URLs (or raw base64 with a mime) become ImageContent
 * attachments; text parts join into the prompt text. Non-image media
 * (video/audio) is intentionally not converted — the session path is
 * image-only; video/audio go through the single-shot complete path where
 * fixMediaPayload rewrites the wire format.
 */
export function partsToPromptInput(parts?: any[]): { text?: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> } {
  if (!parts?.length) return {};
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  const texts: string[] = [];
  for (const p of parts) {
    if (p?.type === 'file' && typeof p.url === 'string' && p.url) {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(p.url);
      if (m) {
        const mime = m[1] || p.mime || 'image/png';
        if (mime.startsWith('image/')) images.push({ type: 'image', mimeType: mime, data: m[3] });
      } else if (typeof p.mime === 'string' && p.mime.startsWith('image/')) {
        images.push({ type: 'image', mimeType: p.mime, data: p.url });
      }
    } else if (typeof p?.text === 'string' && p.text) {
      texts.push(p.text);
    }
  }
  return { text: texts.length ? texts.join('\n') : undefined, images: images.length ? images : undefined };
}
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
      const pi = await imp('@earendil-works/pi-coding-agent');
      const { createAgentSession } = pi;
      const DefaultResourceLoader = pi.DefaultResourceLoader;
      const mr = await modelRuntime();
      const model = mr.getModel(opts.model?.provider ?? provider, opts.model?.modelID ?? modelID);

      // Build session options
      const sessionOpts: any = {
        cwd: opts.cwd,
        modelRuntime: mr,
        model,
        thinkingLevel,
      };

      // If DefaultResourceLoader is available and we have extensions, create a resource loader
      const extensionFactories = opts.extensionFactories ?? [];
      if (DefaultResourceLoader && extensionFactories.length > 0) {
        const resourceLoader = new DefaultResourceLoader({
          cwd: opts.cwd,
          agentDir: piAgentConfig.getAgentDir(),
          extensionFactories,
        });
        await resourceLoader.reload();
        sessionOpts.resourceLoader = resourceLoader;
      }

      const { session } = await createAgentSession(sessionOpts);
      eventStream.trackSession(session);
      return { session };
    },
  }, { sessionTtlMs: cfg.sessionTtlMs, emitEvent: (evt) => eventStream.push(evt), policy: cfg.approvalPolicy });

  const sessionAPI = {
    create: async (opts: { directory?: string }) => {
      const { id } = await registry.create(opts?.directory ?? config.raw.paths.projectDir, { model: { provider, modelID } });
      return { id };
    },
    promptAsync: async (opts: { sessionID: string; message?: string; parts?: any[]; system?: string; agent?: string; noReply?: boolean }) => {
      const converted = partsToPromptInput(opts.parts);
      const text = opts.message ?? converted.text ?? '';
      await registry.promptAsync(opts.sessionID, text, { system: opts.system, agent: opts.agent, noReply: opts.noReply, images: converted.images });
    },
    prompt: async (opts: { sessionID: string; message?: string; parts?: any[]; system?: string; agent?: string; noReply?: boolean }) => {
      const converted = partsToPromptInput(opts.parts);
      const text = opts.message ?? converted.text ?? '';
      return registry.prompt(opts.sessionID, text, { system: opts.system, agent: opts.agent, noReply: opts.noReply, images: converted.images });
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
    completion: {
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        const mr = await modelRuntime();
        const model = mr.getModel(req.model.providerID, req.model.modelID);
        if (!model) throw new Error(`Model ${req.model.providerID}/${req.model.modelID} not found in pi registry`);
        const apiKey = ctx.credentials?.getApiKey?.(req.model.providerID)
          ?? readOpencodeAuth(authPath)[req.model.providerID]?.key;
        if (!apiKey) throw new Error(`No API key for provider "${req.model.providerID}"`);
        await mr.setRuntimeApiKey(req.model.providerID, apiKey);

        const content: any[] = [];
        for (const p of req.user) {
          if (p.type === 'text' && p.text.trim()) content.push({ type: 'text', text: p.text });
          if (p.type === 'image') content.push({ type: 'image', data: p.data, mimeType: p.mimeType });
        }
        const response = await mr.complete(
          model,
          {
            systemPrompt: (req.system ?? []).map((b) => b.text).join('\n\n'),
            messages: [{ role: 'user', content, timestamp: Date.now() }],
          },
          {
            apiKey,
            onPayload: fixMediaPayload,
            signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
          },
        );
        if (response.stopReason === 'error' || response.stopReason === 'aborted') {
          throw new Error(response.errorMessage || `completion failed (${response.stopReason})`);
        }
        const text = (response.content || [])
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n')
          .trim();
        // Tolerant usage mapping — pi field names vary across versions.
        const u = response.usage;
        const input = u?.promptTokens ?? u?.prompt_tokens ?? u?.input;
        const output = u?.completionTokens ?? u?.completion_tokens ?? u?.output;
        const cached = u?.cachedTokens ?? u?.cached_tokens ?? 0;
        return {
          text,
          usage: typeof input === 'number' || typeof output === 'number'
            ? { input: input ?? 0, cached: cached ?? 0, output: output ?? 0 }
            : undefined,
        };
      },
    },
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