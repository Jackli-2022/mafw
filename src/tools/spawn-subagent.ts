import { z } from 'zod';

/** mafw_spawn_subagent — gateway-tracked child session spawn (Batch 3). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export interface SpawnSubagentTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: {
    agent?: string;
    description?: string;
    prompt: string;
    background?: boolean;
    model?: { providerID: string; modelID: string };
    outputSchema?: any;
  }, ctx: { sessionID: string; abort?: AbortSignal }) => Promise<unknown>;
}

export const spawnSubagentTool: SpawnSubagentTool = {
  description:
    '派生一个 gateway 追踪的子代理会话（带 parentID/depth，父会话可用 mafw_subagent_result 取结果、mafw_message_subagent 续聊；取消走网关 cancel API）。异步返回 child sessionID；需要前台等待时优先用 opencode 原生 subagent 工具。',
  args: {
    agent: z.string().optional().describe('子代理 agent 名（如 general/explore）'),
    description: z.string().optional().describe('任务简述（用于子代理标题）'),
    prompt: z.string().describe('发给子代理的任务 prompt'),
    background: z.boolean().optional().describe('标记为后台子代理（默认异步返回）'),
    model: z.object({ providerID: z.string(), modelID: z.string() }).optional().describe('可选的模型覆盖'),
    outputSchema: z.any().optional().describe('可选的结构化输出 JSON Schema（Batch 1 通道）'),
  },
  async execute(args, ctx) {
    if (!ctx?.sessionID) return { title: '子代理创建失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(ctx.sessionID)}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: args.agent,
          description: args.description,
          prompt: args.prompt,
          background: args.background,
          model: args.model,
          outputSchema: args.outputSchema,
        }),
        signal: ctx.abort,
      });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return {
          title: '子代理创建失败',
          output: `SPAWN_FAILED: ${body?.error ?? `HTTP ${res.status}`}`,
          isError: true,
          metadata: body,
        };
      }
      return {
        title: '子代理已创建',
        output: JSON.stringify({ id: body.id, parentID: body.parentID, depth: body.depth, status: body.status }),
        metadata: { sessionID: body.id, depth: body.depth, status: body.status },
      };
    } catch (err: any) {
      return { title: '子代理创建失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
