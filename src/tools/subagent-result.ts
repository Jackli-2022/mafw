import { z } from 'zod';

/** mafw_subagent_result — fetch a child's structured/final result (Batch 3). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const subagentResultTool = {
  description: '读取当前父会话派生的子代理结果：优先 Batch 1 structured 交卷，否则最后一条 assistant 文本。',
  args: {
    sessionID: z.string().describe('子代理 sessionID（mafw_spawn_subagent 返回）'),
  },
  async execute(args: { sessionID: string }, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '结果读取失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(
        `${BASE}/api/sessions/${encodeURIComponent(ctx.sessionID)}/subagents/${encodeURIComponent(args.sessionID)}/result`,
        { signal: ctx.abort },
      );
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '结果读取失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return {
        title: '子代理结果',
        output: JSON.stringify(body),
        metadata: { sessionID: args.sessionID, status: body.status, structured: body.structured !== undefined },
      };
    } catch (err: any) {
      return { title: '结果读取失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
