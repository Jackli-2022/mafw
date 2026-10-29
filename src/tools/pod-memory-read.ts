import { z } from 'zod';
import { podRequest, toolError, type PodTool } from './pod-common';

export const podMemoryReadTool: PodTool = {
  description: '读取项目鲸群（Pod）的共享记忆上下文（POD.md / POD_MEMORY.md / glossary）。',
  args: {
    podId: z.string().describe('Pod id'),
    node: z.enum(['plan', 'execute', 'review']).optional(),
    file: z.enum(['POD', 'MEMORY', 'GLOSSARY']).optional().describe('读取完整文件而非注入上下文'),
  },
  async execute(args, ctx) {
    try {
      const params = new URLSearchParams();
      if (args.node) params.set('node', args.node);
      if (args.file) params.set('file', args.file);
      const query = params.toString() ? `?${params}` : '';
      const body = await podRequest(`/api/pods/${encodeURIComponent(args.podId)}/memory${query}`, { method: 'GET' }, ctx);
      return {
        title: args.file ? `鲸群记忆 · ${args.file}` : '鲸群记忆',
        output: args.file ? (body?.content ?? '(empty)') : (body?.context ?? '(no pod memory)'),
        metadata: { podId: args.podId, file: args.file, hasContext: Boolean(body?.context ?? body?.content) },
      };
    } catch (err) {
      return toolError('鲸群记忆读取失败', err);
    }
  },
};
