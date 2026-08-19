import { z } from 'zod';

/**
 * mafw_python_restart — 重启会话的持久 Python 内核（变量/导入丢失）。
 * 用于内核卡死（busy 不响应）或需要干净状态时。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const RESTART_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/python/restart`;

export interface PythonRestartTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: Record<string, never>, ctx: { sessionID: string; abort: AbortSignal }) => Promise<unknown>;
}

export const pythonRestartTool: PythonRestartTool = {
  description:
    '重启会话的持久 Python 内核。仅在内核卡死（执行长时间无响应/中断后仍 busy）或需要干净状态时使用；' +
    '重启后所有变量、导入、数据都会丢失，需要重新定义。',
  args: {},
  async execute(_args, ctx) {
    try {
      const res = await fetch(RESTART_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: ctx.sessionID }),
        signal: AbortSignal.any([ctx.abort, AbortSignal.timeout(60_000)]),
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return { title: '内核重启失败', output: `内核请求失败：${body?.error || res.status}`, metadata: {} };
      }
      return { title: '内核已重启', output: '会话 Python 内核已重启，变量/导入已清空，可重新定义。', metadata: {} };
    } catch (err) {
      return { title: '内核重启失败', output: `内核调用失败：${(err as Error).message}`, metadata: {} };
    }
  },
};
