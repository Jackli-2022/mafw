import { z } from 'zod';

/**
 * mafw_add_memory — save a memory unit to the harmonic memory system.
 * Serve sessions (including pipeline worker sessions) have no MCP connection,
 * so writes go over HTTP to the gateway's /api/memory/add (shared harmonic store).
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const ADD_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/memory/add`;

export interface AddMemoryTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (
    args: {
      content: string;
      memoryType?: 'semantic' | 'episodic' | 'procedural' | 'global';
      cueAnchors?: string[];
      primaryAbstraction?: string;
    },
    ctx: { sessionID: string; abort: AbortSignal },
  ) => Promise<unknown>;
}

export const addMemoryTool: AddMemoryTool = {
  description:
    '保存一条记忆到谐波记忆系统。用于需要跨会话存续的事实、决定、偏好、教训、模式与洞察。' +
    '一次调用保存一条，memory_value 简洁，附 cueAnchors 关键词；按内容选择 memoryType（semantic=事实/偏好/约束，episodic=叙事，procedural=教训/模式，global=跨项目）。',
  args: {
    content: z.string().describe('记忆内容（一句话）'),
    memoryType: z
      .enum(['semantic', 'episodic', 'procedural', 'global'])
      .optional()
      .describe('semantic=事实/偏好/约束，episodic=叙事，procedural=教训/模式，global=跨项目'),
    cueAnchors: z.array(z.string()).max(8).optional().describe('检索关键词'),
    primaryAbstraction: z.string().optional().describe('6-8 词摘要（缺省自动生成）'),
  },
  async execute(args, ctx) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(ADD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: args.content,
          memoryType: args.memoryType || 'semantic',
          cueAnchors: args.cueAnchors || [],
          primaryAbstraction: args.primaryAbstraction,
          sessionID: ctx?.sessionID,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok || body?.success === false) {
        return { title: '记忆写入失败', output: JSON.stringify(body), metadata: {} };
      }
      return { title: '记忆已保存', output: JSON.stringify({ success: true, id: body.id }), metadata: { memoryID: body.id } };
    } catch (err: any) {
      return { title: '记忆写入失败', output: `gateway unreachable: ${err.message}`, metadata: {} };
    }
  },
};
