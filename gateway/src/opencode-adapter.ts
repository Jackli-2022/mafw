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

import type {
  RuntimeClient,
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
} from './runtime/contract';
export type {
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
} from './runtime/contract';

/** @deprecated 等价于 RuntimeClient；保留别名避免下游改动。 */
export type OpencodeAdapter = RuntimeClient;

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

export async function createOpencodeAdapter(config: { baseUrl: string; directory?: string; headers?: Record<string, string> }): Promise<OpencodeAdapter> {
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
  const client = createOpencodeClient(config);

  // opencode 原生 V1 路由的 workspace 路由细节收敛在 adapter 内（契约保持
  // runtime 中立）——带 directory 的调用直连 fetch（V2 SDK 调用不带 workspace 语义）。
  const directNative = async (
    path: string,
    method: string,
    body?: any,
    directory?: string,
  ): Promise<any> => {
    const url = `${config.baseUrl}${path}${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
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

      async permissionReply(
        sessionID: string,
        requestId: string,
        reply: 'once' | 'always' | 'reject',
        message?: string,
      ): Promise<boolean> {
        const result = await (client.session as any).permission.reply({
          sessionID,
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
          const result = await (client.session as any).question.list(
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
          const result = await (client.session as any).question.reply({
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
          const result = await (client.session as any).question.reject({ requestID: opts.requestID });
          if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
            throw new Error(String((result as any).error));
          }
        },
      },

      async permissionList(opts?: { directory?: string }) {
        const data = await directNative('/permission', 'GET', undefined, opts?.directory);
        return Array.isArray(data) ? data : data?.items ?? [];
      },
    },

    global: {
      event() {
        return client.global.event();
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
  };
}
