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

export async function createOpencodeAdapter(config: { baseUrl: string; directory?: string }): Promise<OpencodeAdapter> {
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
  const client = createOpencodeClient(config);

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
          noReply: opts.noReply,
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
        return unwrap(result);
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
