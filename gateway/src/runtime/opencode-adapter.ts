/**
 * OpencodeAdapter - 适配层，隔离上层代码与 opencode SDK 版本变化
 * 
 * 设计目标：
 * 1. 扁平参数：{ sessionID, parts } 而非 { path: { id }, body: { parts } }
 * 2. 自动解包：内部处理 result.data ?? result
 * 3. 便捷参数：message 自动转为 parts
 * 4. 统一接口：消除 v1 嵌套 vs langgraph 扁平两种风格
 */

// ─── 接口定义（单源在 runtime/contract.ts，此处仅转发保持兼容） ─────────────

import { serveAuthHeaders } from './serve-sidecar';
import type {
  RuntimeClient,
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
  NativeToolDeclaration,
} from './contract';
export type {
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
} from './contract';

/** @deprecated 等价于 RuntimeClient；保留别名避免下游改动。 */
export type OpencodeAdapter = RuntimeClient;

/** opencode 原生工具清单（tool-classes overlay 声明；调研表 2026-10-13）。 */
const OPENCODE_NATIVE_TOOLS: NativeToolDeclaration[] = [
  { name: 'read', toolClass: 'readonly' },
  { name: 'grep', toolClass: 'search' },
  { name: 'glob', toolClass: 'search' },
  { name: 'list', toolClass: 'search' },
  { name: 'write', toolClass: 'file-edit' },
  { name: 'edit', toolClass: 'file-edit' },
  { name: 'bash', toolClass: 'shell' },
  { name: 'shell', toolClass: 'shell' },
  { name: 'task', toolClass: 'subagent' },
  { name: 'webfetch', toolClass: 'web' },
  { name: 'todowrite', toolClass: 'plan' },
];

// ─── 工具函数 ───────────────────────────────────────────────

function unwrap<T>(result: any): T {
  if (result?.data !== undefined) return result.data;
  return result;
}

function messageToParts(message?: string, parts?: any[]): any[] {
  if (parts && parts.length > 0) return parts;
  if (message) return [{ type: 'text', text: message }];
  return [];
}

// ─── 适配层实现 ─────────────────────────────────────────────

export async function createOpencodeAdapter(config: { baseUrl: string; headers?: Record<string, string> }): Promise<OpencodeAdapter> {
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
  // 2.1.0 兼容（2026-10-22 事故第三层修复）：
  // ① API 全挂 /api 前缀——SDK 模板（/session/...）拼上 /api 后命中 2.1.0 路由；
  // ② serve 强制 Basic auth——headers 补 Authorization（serveAuthHeaders 单源，
  //    与 sidecar spawn 的 OPENCODE_SERVER_PASSWORD 同值；外部传入 headers 优先合并）。
  const buildSdkConfig = (base: string) => ({
    baseUrl: base.replace(/\/+$/, '') + '/api',
    headers: { ...serveAuthHeaders(), ...(config.headers ?? {}) },
  });
  let current = createOpencodeClient(buildSdkConfig(config.baseUrl));
  let clientBaseUrl = config.baseUrl;
  // URL 吸收：runtime 的 spawnServe 会把 sidecar 实际地址写回 config.baseUrl
  // （动态端口前提）。SDK 客户端内部持有构造期 config 快照，感知不到变更——
  // 每次访问按 baseUrl 惰性重建（幂等，无变更零开销）。directNative/
  // healthCheck 直读 config.baseUrl，天然跟随。
  const client = new Proxy(current, {
    get(_t, prop) {
      if (config.baseUrl !== clientBaseUrl) {
        clientBaseUrl = config.baseUrl;
        current = createOpencodeClient(buildSdkConfig(config.baseUrl));
      }
      return Reflect.get(current as object, prop, current as object);
    },
  }) as typeof current;

  // opencode 原生 V1 路由的 workspace 路由细节收敛在 adapter 内（契约保持
  // runtime 中立）——带 directory 的调用直连 fetch（V2 SDK 调用不带 workspace 语义）。
  // 2.1.0：directNative 同样走 /api 前缀 + Basic auth。
  const directNative = async (
    path: string,
    method: string,
    body?: any,
    directory?: string,
  ): Promise<any> => {
    const url = `${config.baseUrl}/api${path}${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
        ...serveAuthHeaders(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(directory ? { 'x-opencode-directory': encodeURIComponent(directory) } : {}),
        ...(config.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    } as any);
    if (!res.ok) throw new Error(`opencode native ${path} failed: ${res.status}`);
    try { return await res.json(); } catch { return null; }
  };

  return {
    session: {
      async create(opts: SessionCreateOpts) {
        const result = await client.session.create({
          directory: opts.directory,
        });
        return unwrap(result);
      },

      async promptAsync(opts: SessionPromptOpts) {
        const parts = messageToParts(opts.message, opts.parts);
        await client.session.promptAsync({
          sessionID: opts.sessionID,
          parts,
          agent: opts.agent,
          model: opts.model,
          variant: opts.variant,
          system: opts.system,
          noReply: opts.noReply ?? (opts.expectReply === false ? true : undefined),
        });
      },

      async prompt(opts: SessionPromptOpts) {
        const parts = messageToParts(opts.message, opts.parts);
        const result = await client.session.prompt({
          sessionID: opts.sessionID,
          parts,
          agent: opts.agent,
          model: opts.model,
          variant: opts.variant,
          system: opts.system,
          noReply: opts.noReply,
        });
        const data = unwrap<any>(result);
        const info = data?.info;
        const t = info?.tokens;
        return {
          ...data,
          parts: data?.parts ?? [],
          finish: info?.finish,
          usage: t
            ? {
                input: t.input ?? 0,
                output: t.output ?? 0,
                cached: t.cache?.read ?? 0,
                reasoning: t.reasoning ?? 0,
                costUsd: typeof info?.cost === 'number' ? info.cost : undefined,
              }
            : undefined,
          error: info?.error
            ? {
                name: info.error.name ?? info.error.type ?? 'Error',
                message: info.error.data?.message ?? info.error.message ?? String(info.error),
              }
            : undefined,
        };
      },

      async messages(opts: SessionMessagesOpts) {
        const result = await client.session.messages({
          sessionID: opts.sessionID,
          limit: opts.limit,
          before: opts.before,
        });
        const data = unwrap<any[]>(result);
        const nextCursor = result?.response?.headers?.get('X-Next-Cursor') || undefined;
        return { data, nextCursor };
      },

      async get(opts: { sessionID: string }) {
        const result = await client.session.get({
          sessionID: opts.sessionID,
        });
        return unwrap(result);
      },

      async delete(opts: { sessionID: string }) {
        const result = await client.session.delete({
          sessionID: opts.sessionID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async update(opts: { sessionID: string; title: string }) {
        // v2 SDK signature is flat: { sessionID, title }
        const result = await client.session.update({
          sessionID: opts.sessionID,
          title: opts.title,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async abort(opts: { sessionID: string }) {
        await client.session.abort({
          sessionID: opts.sessionID,
        });
      },

      async list(opts?: { directory?: string }) {
        const result = await client.session.list({
          directory: opts?.directory,
        });
        return unwrap<any[]>(result);
      },

      async todo(opts: { sessionID: string }) {
        const result = await client.session.todo({
          sessionID: opts.sessionID,
        });
        return unwrap<any[]>(result);
      },

      async children(opts: { sessionID: string }) {
        const result = await client.session.children({
          sessionID: opts.sessionID,
        });
        return unwrap<any[]>(result);
      },

      async summarize(opts: SessionSummarizeOpts) {
        const result = await client.session.summarize({
          sessionID: opts.sessionID,
          providerID: opts.providerID,
          modelID: opts.modelID,
        });
        return unwrap(result);
      },

      async fork(opts: { sessionID: string; messageID?: string }) {
        const result = await client.session.fork({
          sessionID: opts.sessionID,
          messageID: opts.messageID,
        });
        const session = unwrap<any>(result);
        return { id: session?.id };
      },

      async revert(opts: { sessionID: string; messageID: string; partID?: string }) {
        const result = await client.session.revert({
          sessionID: opts.sessionID,
          messageID: opts.messageID,
          partID: opts.partID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async unrevert(opts: { sessionID: string }) {
        const result = await client.session.unrevert({
          sessionID: opts.sessionID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async diff(opts: { sessionID: string; messageID?: string }) {
        const result = await client.session.diff({
          sessionID: opts.sessionID,
          ...(opts.messageID ? { messageID: opts.messageID } : {}),
        });
        return unwrap<any[]>(result) ?? [];
      },

      vcs: {
        async diff(opts?: { mode?: 'git' | 'branch' }) {
          const result = await client.vcs.diff({ mode: opts?.mode ?? 'git' });
          return unwrap<any[]>(result) ?? [];
        },
        async apply(opts: { patch: string }) {
          await client.vcs.apply({ patch: opts.patch });
        },
      },

      async permissionReply(
        sessionID: string,
        requestId: string,
        reply: 'once' | 'always' | 'reject',
        message?: string,
      ): Promise<boolean> {
        // v2 SDK：Permission 是 client 顶层命名空间（/permission/{requestID}/reply），
        // session 上没有 permission 成员；requestID 全局唯一定位，sessionID 仅契约签名兼容保留。
        const result = await client.permission.reply({
          requestID: requestId,
          reply,
          ...(message ? { message } : {}),
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
        return true;
      },

      question: {
        async list(opts?: { directory?: string }) {
          // SDK 1.18.x：question 是 OpencodeClient 顶层命名空间（session 上没有）
          const result = await client.question.list(
            opts?.directory ? { directory: opts.directory } : undefined,
          );
          const data = unwrap<any>(result);
          return Array.isArray(data) ? data : data?.items ?? [];
        },
        async reply(opts: { requestID: string; answers: string[][]; directory?: string }) {
          if (opts.directory) {
            await directNative(`/question/${opts.requestID}/reply`, 'POST', { answers: opts.answers }, opts.directory);
            return;
          }
          const result = await client.question.reply({
            requestID: opts.requestID,
            answers: opts.answers,
          });
          if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
            throw new Error(String((result as any).error));
          }
        },
        async reject(opts: { requestID: string; directory?: string }) {
          if (opts.directory) {
            await directNative(`/question/${opts.requestID}/reject`, 'POST', undefined, opts.directory);
            return;
          }
          const result = await client.question.reject({ requestID: opts.requestID });
          if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
            throw new Error(String((result as any).error));
          }
        },
      },

      async permissionList(opts?: { directory?: string }) {
        // 2.1.0：permission 列表路由在 /api/permission/request（+directory query）；
        // 旧 /permission 已 404。返回形状 {location, data[]} — data 兼容提取。
        const data = await directNative('/permission/request', 'GET', undefined, opts?.directory);
        return Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
      },
    },

    global: {
      event() {
        // 2.1.0：SSE 流在 Event class（/event → /api/event，实测 200）；
        // Global class 的 /global/event 已 404（2026-10-22 事故第三层）
        return client.event.subscribe();
      },
    },

    provider: {
      async list() {
        const result = await client.provider.list();
        return unwrap(result);
      },
    },

    app: {
      async agents() {
        const result = await client.app.agents();
        return unwrap<any[]>(result);
      },
    },

    config: {
      async get() {
        const result = await client.config.get();
        return unwrap(result);
      },

      async update(config: any) {
        const result = await client.config.update({
          config,
        });
        return unwrap(result);
      },
    },

    // 工具注册通道（Tier-0 必选）：六件套由 v1 宿主插件承载（plugin-native 工具）
    // + MCP 面由自接线覆盖——通道已存在，spec 推送 = 通道确认（no-op ack）。
    tools: {
      async registerTools() {
        /* ack — tools hosted by v1 plugin + MCP self-wiring */
      },
      nativeTools() { return OPENCODE_NATIVE_TOOLS; },
    },
  };
}
