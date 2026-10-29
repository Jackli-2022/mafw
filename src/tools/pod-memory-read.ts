import { z } from 'zod';
import { podRequest, toolError, type PodTool } from './pod-common';

export const podMemoryReadTool: PodTool = {
  description: '读取项目鲸群（Pod）的共享记忆上下文（POD.md / POD_MEMORY.md / glossary）。',
  args: {
    podId: z.string().describe('Pod id'),
    node: z.enum(['plan', 'execute', 'review']).optional(),
  },
  async execute(args, ctx) {
    try {
      const query = args.node ? `?node=${encodeURIComponent(args.node)}` : '';
      const body = await podRequest(`/api/pods/${encodeURIComponent(args.podId)}/memory${query}`, { method: 'GET' }, ctx);
      return {
        title: '鲸群记忆',
        output: body?.context ?? '(no pod memory)',
        metadata: { podId: args.podId, hasContext: typeof body?.context === 'string' },
      };
    } catch (err) {
      return toolError('鲸群记忆读取失败', err);
    }
  },
};
