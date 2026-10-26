import { z } from 'zod';

/** mafw_task_submit — submit a durable gateway task (Batch 4). */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const BASE = `http://127.0.0.1:${PORT}`;

export const taskSubmitTool = {
  description:
    '提交一个 gateway 持久任务：shell=后台命令（跨重启可查、可取消），subagent=后台子代理。异步返回 task id/status；用 mafw_task_list 查状态、mafw_task_cancel 取消、mafw_task_message 给子代理续聊。',
  args: {
    kind: z.enum(['shell', 'subagent']).describe('任务类型'),
    command: z.string().optional().describe('shell 任务命令'),
    prompt: z.string().optional().describe('subagent 任务 prompt'),
    title: z.string().optional().describe('任务标题'),
    cwd: z.string().optional().describe('shell 工作目录'),
    timeout: z.number().int().positive().optional().describe('shell 超时毫秒'),
    agent: z.string().optional().describe('子代理 agent 名'),
    description: z.string().optional().describe('子代理任务简述'),
    model: z.object({ providerID: z.string(), modelID: z.string() }).optional().describe('可选模型覆盖'),
    outputSchema: z.any().optional().describe('可选结构化输出 JSON Schema'),
  },
  async execute(args: any, ctx: { sessionID: string; abort?: AbortSignal }) {
    if (!ctx?.sessionID) return { title: '任务提交失败', output: 'missing sessionID', isError: true, metadata: {} };
    try {
      const res = await fetch(`${BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...args, parentSessionID: ctx.sessionID }),
        signal: ctx.abort,
      });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        return { title: '任务提交失败', output: body?.error ?? `HTTP ${res.status}`, isError: true, metadata: body };
      }
      return {
        title: '任务已提交',
        output: JSON.stringify({ id: body.id, kind: body.kind, status: body.status }),
        metadata: { taskID: body.id, kind: body.kind, status: body.status },
      };
    } catch (err: any) {
      return { title: '任务提交失败', output: `gateway unreachable: ${err?.message ?? err}`, isError: true, metadata: {} };
    }
  },
};
