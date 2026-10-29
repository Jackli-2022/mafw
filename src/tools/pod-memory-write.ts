import { z } from 'zod';
import { podRequest, toolError, type PodTool } from './pod-common';

export const podMemoryWriteTool: PodTool = {
  description: '写入项目鲸群（Pod）的共享记忆文件；仅 Pod Lead 可写。',
  args: {
    podId: z.string().describe('Pod id'),
    file: z.enum(['POD', 'MEMORY', 'GLOSSARY']).describe('POD.md / POD_MEMORY.md / glossary.md'),
    content: z.string().describe('完整文件内容'),
  },
  async execute(args, ctx) {
    try {
      const body = await podRequest(`/api/pods/${encodeURIComponent(args.podId)}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: args.file,
          content: args.content,
          actorSessionID: ctx.sessionID,
        }),
      }, ctx);
      return {
        title: '鲸群记忆已写入',
        output: body?.path ?? 'ok',
        metadata: { podId: args.podId, file: args.file },
      };
    } catch (err) {
      return toolError('鲸群记忆写入失败', err);
    }
  },
};
