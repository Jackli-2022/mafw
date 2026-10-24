import { z } from 'zod';

/**
 * mafw_submit_result — 结构化输出交卷工具（Batch 1）。
 *
 * 只有 prompt 尾部出现 [MAFW STRUCTURED OUTPUT] 时才应调用；data 由 gateway
 * 按当前 session 注册的 JSON Schema 校验，失败返回具体路径错误，模型可在同一
 * 回合内修正后重试。
 */
const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const SUBMIT_URL = `http://127.0.0.1:${PORT}/api/structured/submit`;

export interface SubmitResultTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (
    args: { data: Record<string, unknown> },
    ctx: { sessionID: string; abort?: AbortSignal },
  ) => Promise<unknown>;
}

export const submitResultTool: SubmitResultTool = {
  description:
    '结构化输出交卷。只有 prompt 中出现 [MAFW STRUCTURED OUTPUT] 时调用：把最终结果作为 data 对象提交，gateway 会按当前 JSON Schema 校验；失败时按返回的路径错误修正后再次调用。',
  args: {
    data: z.record(z.any()).describe('符合当前回合 JSON Schema 的结构化结果对象'),
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: ctx?.sessionID, data: args?.data }),
        signal: ctx?.abort,
      });
      let body: any = {};
      try { body = await res.json(); } catch { /* ignore */ }
      if (!res.ok || body?.ok === false) {
        const errors = Array.isArray(body?.errors)
          ? body.errors
          : [body?.error || `HTTP ${res.status}`];
        return {
          title: '结构化结果未通过校验',
          output: `SCHEMA_VALIDATION_FAILED\n${errors.join('\n')}`,
          isError: true,
          metadata: { errors },
        };
      }
      return { title: '结构化结果已提交', output: JSON.stringify({ ok: true }), metadata: { structured: true } };
    } catch (err: any) {
      return {
        title: '结构化结果提交失败',
        output: `gateway unreachable: ${err?.message ?? err}`,
        isError: true,
        metadata: {},
      };
    }
  },
};
