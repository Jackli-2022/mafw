import * as fs from 'fs';
import {
  defineRuntime,
  type AdapterSession,
  type RuntimeAgentDefinition,
  type RuntimeCapabilities,
  type RuntimeChannels,
  type RuntimeDefinition,
  type RuntimeFactoryContext,
  type RuntimeHostSurface,
  type RuntimeToolRegistration,
  type RuntimeTransport,
  type SendTurnInput,
  type ThinkingLevel,
} from '@mafw/runtime-contract';
import { fixMediaPayload, requireSessionDir } from '@mafw/runtime-core';
import { PiSessionRegistry } from './pi-session';
import { normalizePiMessages } from './pi-message-normalize';
import { PiEventStream } from './pi-events';
import { translateProviders, translateConfigGet, translateConfigUpdate } from './pi-provider';
import { listByDirectory } from './pi-session-storage';
import * as piAgentConfig from './pi-agent-config';
import { applyPiPolicyHooks } from './pi-policy';

export const PI_DEFINITION_NAME = 'pi';

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
  sessionBranchApi: true,
  runStateApi: true,
  discoveryApi: false,
  // pi native streamingBehavior:'steer' (injects between tool calls).
  steerApi: true,
  // Creator tools/skills are OpenCode plugin-host artifacts; pi does not materialize mafw-create.
  pluginCreatorApi: false,
};

interface PiNativeTool {
  name: string;
  toolClass: string;
  canonical?: string;
}

/** pi native tools (pi-coding-agent dist/core/tools: read/grep/find/ls/write/edit/bash). */
const PI_NATIVE_TOOLS: PiNativeTool[] = [
  { name: 'read', toolClass: 'readonly' },
  { name: 'grep', toolClass: 'search' },
  { name: 'find', toolClass: 'search', canonical: 'glob' },
  { name: 'ls', toolClass: 'search', canonical: 'list' },
  { name: 'write', toolClass: 'file-edit' },
  { name: 'edit', toolClass: 'file-edit' },
  { name: 'bash', toolClass: 'shell' },
];

/**
 * Convert runtime prompt parts into pi prompt input. File parts carrying data
 * URLs (or raw base64 with a mime) become ImageContent attachments; text parts
 * join into the prompt text. Video/audio remain as `media` carriers for the
 * mafw-media extension (before_provider_request).
 */
export function partsToPromptInput(parts?: any[]): {
  text?: string;
  images?: Array<{ type: 'image'; data: string; mimeType: string }>;
  media?: Array<{ type: 'video' | 'audio'; url: string; mime: string; filename?: string }>;
} {
  if (!parts?.length) return {};
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  const media: Array<{ type: 'video' | 'audio'; url: string; mime: string; filename?: string }> = [];
  const texts: string[] = [];
  for (const p of parts) {
    if (p?.type === 'file') {
      const ref = p.ref ?? {};
      const rawUrl = typeof p.url === 'string' ? p.url : typeof ref.url === 'string' ? ref.url : undefined;
      const rawMime = typeof p.mime === 'string' ? p.mime : typeof ref.mime === 'string' ? ref.mime : '';
      let url = rawUrl;
      if (!url && typeof ref.path === 'string') {
        try {
          url = `data:${rawMime || 'application/octet-stream'};base64,${fs.readFileSync(ref.path).toString('base64')}`;
        } catch { url = undefined; }
      }
      const m = url ? /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url) : null;
      const mime = m?.[1] || rawMime || '';
      const data = m?.[3];
      if (mime.startsWith('image/') && data) {
        images.push({ type: 'image', mimeType: mime, data });
      } else if (mime.startsWith('video/') || mime.startsWith('audio/')) {
        if (url) media.push({ type: mime.startsWith('video/') ? 'video' : 'audio', url, mime, filename: p.filename });
      } else if (rawMime.startsWith('image/') && rawUrl) {
        images.push({ type: 'image', mimeType: rawMime, data: rawUrl });
      }
    } else if (typeof p?.text === 'string' && p.text) {
      texts.push(p.text);
    }
  }
  return {
    text: texts.length ? texts.join('\n') : undefined,
    images: images.length ? images : undefined,
    media: media.length ? media : undefined,
  };
}

export interface PiRuntimeDeps {
  loadPi?: () => Promise<any>;
  timeoutMs?: number;
}

export interface PiRuntimeState {
  definition: RuntimeDefinition;
  registry: PiSessionRegistry;
  eventStream: PiEventStream;
}

/**
 * Build the pi driver state and its neutral definition. The returned registry
 * is a test/media seam; production only consumes `definition`.
 */
export async function createPiState(
  ctx: RuntimeFactoryContext,
  deps: PiRuntimeDeps = {},
): Promise<PiRuntimeState> {
  const cfg = ctx.pluginConfig('pi') as Record<string, any>;
  const provider = cfg.provider ?? 'xiaomi';
  const modelID = cfg.model ?? 'mimo-v2.6-pro';
  const thinkingLevel = cfg.thinkingLevel ?? 'medium';

  const imp = deps.loadPi ?? (new Function('spec', 'return import(spec)') as (s: string) => Promise<any>);

  let mrPromise: Promise<any> | undefined;
  function modelRuntime(): Promise<any> {
    if (!mrPromise) {
      mrPromise = (async () => {
        const { ModelRuntime } = await imp('@earendil-works/pi-coding-agent');
        const mr = await ModelRuntime.create({ signal: AbortSignal.timeout(30_000) });
        const key = ctx.credentials?.getApiKey?.(provider);
        if (key) await mr.setRuntimeApiKey(provider, key);
        return mr;
      })();
      mrPromise.catch(() => { mrPromise = undefined; });
    }
    return mrPromise;
  }

  const eventStream = new PiEventStream((session: any) => registry.sessionIdFor(session));
  const registry: PiSessionRegistry = new PiSessionRegistry({
    createSession: async (opts: any) => {
      const pi = await imp('@earendil-works/pi-coding-agent');
      const { createAgentSession } = pi;
      const DefaultResourceLoader = pi.DefaultResourceLoader;
      const mr = await modelRuntime();
      const model = mr.getModel(opts.model?.provider ?? provider, opts.model?.modelID ?? modelID);

      const sessionOpts: any = { cwd: opts.cwd, modelRuntime: mr, model, thinkingLevel };

      if (opts.fromFile && pi.SessionManager) {
        sessionOpts.sessionManager = pi.SessionManager.open(opts.fromFile, undefined, opts.cwd);
      }

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
  }, {
    sessionTtlMs: cfg.sessionTtlMs,
    emitEvent: (evt) => eventStream.push(evt),
    policy: cfg.approvalPolicy,
    ...(cfg.hostExtension === false ? {} : {
      hostBaseUrl: `http://127.0.0.1:${ctx.gatewayPort ?? 3000}`,
      getType: async () => {
        const mod = await imp('@earendil-works/pi-coding-agent/node_modules/typebox');
        return mod.Type;
      },
    }),
  });

  applyPiPolicyHooks(registry as any, ctx.policy);

  const transport: RuntimeTransport = {
    async createSession(input) {
      const dir = requireSessionDir(input.directory, ctx.projectDir);
      const { id } = await registry.create(dir, { model: { provider, modelID } });
      return { sessionID: id };
    },
    async sendTurn(input: SendTurnInput) {
      const converted = partsToPromptInput(input.parts);
      const text = input.text ?? converted.text ?? '';
      if (converted.media?.length) registry.attachMedia(input.sessionID, converted.media);
      await registry.promptAsync(input.sessionID, text, {
        system: input.system,
        agent: input.agent,
        expectReply: input.expectReply,
        delivery: input.delivery === 'queue' ? undefined : input.delivery,
        images: converted.images,
      });
      return { turnID: input.turnID };
    },
    async steer(sessionID, text, parts) {
      const converted = partsToPromptInput(parts);
      if (converted.media?.length) registry.attachMedia(sessionID, converted.media);
      await registry.promptAsync(sessionID, text ?? converted.text ?? '', { delivery: 'steer', images: converted.images });
      return 'steered';
    },
    async interruptTurn(sessionID) {
      await registry.abort(sessionID);
    },
    async respondToRequest(sessionID, requestID, decision) {
      if (typeof registry.permissionReply !== 'function') return 'unavailable';
      const reply = decision.behavior === 'answer'
        ? 'once'
        : decision.behavior === 'allow' ? (decision.always ? 'always' : 'once') : 'reject';
      const accepted = await registry.permissionReply(sessionID, requestID, reply, decision.message);
      // Unknown session / already-settled request ⇒ false: never report a
      // grant that the native bridge did not apply.
      if (!accepted) return 'rejected';
      return decision.behavior === 'answer' ? 'answered' : 'allowed-once';
    },
    onEvent(listener) {
      let cancelled = false;
      void (async () => {
        const stream = eventStream.stream();
        try {
          for await (const evt of stream) {
            if (cancelled) return;
            listener(evt);
          }
        } catch { /* stream teardown */ }
      })();
      return () => { cancelled = true; };
    },
    async stop() {
      await registry.disposeAll();
      await eventStream.dispose();
    },
  };

  const sessionChannels: NonNullable<RuntimeChannels['session']> = {
    list: async () => registry.list() as Promise<AdapterSession[]>,
    listByDirectory: async (directory, limit) => listByDirectory(directory, limit),
    get: async (sessionID) => {
      const session = await registry.get(sessionID);
      if (!session) throw new Error(`pi session ${sessionID} not found`);
      return session as AdapterSession;
    },
    update: async (sessionID, patch) => {
      const live = registry.sessionFor(sessionID);
      if (live) {
        if (typeof live.setSessionName === 'function') live.setSessionName(patch.title ?? '');
        else if (typeof live.sessionManager?.appendSessionInfo === 'function') live.sessionManager.appendSessionInfo(patch.title ?? '');
        else throw new Error('pi session.update: live session exposes no rename primitive (setSessionName/appendSessionInfo)');
        return;
      }
      const pi = await imp('@earendil-works/pi-coding-agent');
      const SM = pi.SessionManager;
      if (!SM?.list || !SM?.open) throw new Error('pi session.update: SessionManager.list/open unavailable');
      const dir = ctx.projectDir;
      if (!dir) throw new Error('pi session.update: projectDir unavailable');
      const found = ((await SM.list(dir)) as any[]).find((s) => s.id === sessionID);
      if (!found) throw new Error(`pi session.update: session ${sessionID} not found (live or persisted under ${dir})`);
      const sm = SM.open(found.path);
      if (typeof sm.appendSessionInfo !== 'function') throw new Error('pi session.update: SessionManager.appendSessionInfo unavailable');
      sm.appendSessionInfo(patch.title ?? '');
    },
    delete: async (sessionID) => { await registry.delete(sessionID); },
    abort: async (sessionID) => { await registry.abort(sessionID); },
    todo: async () => registry.todo(),
    children: async () => registry.children() as Promise<AdapterSession[]>,
    summarize: async (input) => registry.summarize(input.sessionID),
    setThinkingLevel: async (sessionID, level: ThinkingLevel) => registry.setThinkingLevel(sessionID, level),
    permissionList: async () => registry.listPendingPermissions(),
  };

  const channels: RuntimeChannels = {
    tools: {
      registerTools: (factory) => registry.setToolFactory(factory as (sessionID: string) => RuntimeToolRegistration[]),
      nativeTools: () => PI_NATIVE_TOOLS,
    },
    session: sessionChannels,
    messages: {
      // `list` returns the native history; the neutral runtime applies
      // `normalize` once (flat MAFW DTO is the only history exit).
      list: async (sessionID) => registry.messages(sessionID),
      normalize: (raw) => normalizePiMessages(raw as any[]),
    },
    providers: {
      list: async () => translateProviders(await modelRuntime()),
    },
    agents: {
      // pi has no native agent picker: identities are installed as prompt
      // files and surfaced through the gateway identity registry.
      list: async () => [],
      install: async (name, definition) => piAgentConfig.install(name, definition as RuntimeAgentDefinition),
      remove: async (name) => piAgentConfig.remove(name),
    },
    branch: {
      fork: async (sessionID, messageID) => {
        const { id } = await registry.fork(sessionID, messageID);
        return { sessionID: id };
      },
      revert: async (sessionID, messageID) => registry.revert(sessionID, messageID),
    },
    mediaSession: {
      create: async (opts) => ({ sessionID: (await transport.createSession({ directory: opts.directory })).sessionID }),
    },
  };

  const host: RuntimeHostSurface = {
    config: {
      get: () => translateConfigGet(),
      update: (config) => translateConfigUpdate(config),
    },
    credentials: {
      getApiKey: (providerID) => ctx.credentials?.getApiKey?.(providerID) ?? null,
    },
    completion: {
      async complete(req: any) {
        const mr = await modelRuntime();
        const model = mr.getModel(req.model.providerID, req.model.modelID);
        if (!model) throw new Error(`Model ${req.model.providerID}/${req.model.modelID} not found in pi registry`);
        const apiKey = ctx.credentials?.getApiKey?.(req.model.providerID);
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
            systemPrompt: (req.system ?? []).map((b: any) => b.text).join('\n\n'),
            messages: [{ role: 'user', content, timestamp: Date.now() }],
          },
          { apiKey, onPayload: fixMediaPayload, signal: AbortSignal.timeout(req.timeoutMs ?? deps.timeoutMs ?? 180_000) },
        );
        if (response.stopReason === 'error' || response.stopReason === 'aborted') {
          throw new Error(response.errorMessage || `completion failed (${response.stopReason})`);
        }
        const text = (response.content || [])
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n')
          .trim();
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
    healthCheck: async () => { try { await modelRuntime(); return true; } catch { return false; } },
    getBaseUrl: () => `http://127.0.0.1:${ctx.gatewayPort ?? 3000}`,
  };

  const definition = defineRuntime({
    api: 1,
    eventApi: 1,
    name: 'pi',
    displayName: 'pi',
    preset: 'autonomous',
    external: true,
    transport,
    channels,
    host,
    semantics: {
      'prompt.delivery.steer': { boundary: 'tool' },
      'branch.revert': { files: false, undo: false },
      'branch.runState': { requireBusy: true },
    },
    overrides: PI_CAPABILITIES,
  });

  return { definition, registry, eventStream };
}

export async function createPiDefinition(
  ctx: RuntimeFactoryContext,
  deps: PiRuntimeDeps = {},
): Promise<RuntimeDefinition> {
  return (await createPiState(ctx, deps)).definition;
}
