import { z } from 'zod';

/**
 * mafw_python — 在会话的持久 Python 内核中执行代码（Prime Agent / Jupyter kernel 架构）。
 *
 * 变量、导入、数据跨调用保持（同一会话共享一个内核）。适合：数据分析/统计/
 * 科学计算/多步计算（后续代码要复用前面的变量与结果）。matplotlib 图表会以
 * 图片附件返回，可用 mafw_media_upload / mafw_media_ask 查看。
 */

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
const EXECUTE_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/python/execute`;

export interface PythonExecTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (
    args: { code: string },
    ctx: { sessionID: string; abort: AbortSignal },
  ) => Promise<unknown>;
}

export const pythonExecTool: PythonExecTool = {
  description:
    '在会话的持久 Python 内核中执行代码（数据分析/统计/科学计算/多步计算时优先用本工具，' +
    '不要用 bash 里的 python -c —— 本工具变量和导入跨调用保持，无需重复定义）。' +
    '例如：先执行 x = [1,2,3]，下一次调用可直接 print(sum(x))。' +
    'matplotlib 图表会作为图片附件返回，可用 mafw_media_upload/mafw_media_ask 查看。' +
    '项目代码、测试、CLI、依赖检查请用 bash 走项目自己的环境。参数：code — 要执行的 Python 代码。',
  args: {
    code: z.string().describe('要执行的 Python 代码（状态跨调用保持）'),
  },
  async execute({ code }, ctx) {
    const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(180_000)]);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: ctx.sessionID, code }),
        signal,
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        return { title: 'Python 执行失败', output: `内核请求失败：${body?.error || res.status}`, metadata: {} };
      }
      const r = await res.json() as any;

      // Structured payload for the desktop tool card (MafwPythonCard).
      // Images are capped to keep part.state.metadata reasonable.
      const images = (r.attachments || [] as any[])
        .filter((a: any) => typeof a?.data === 'string')
        .slice(0, 4)
        .map((a: any) => ({
          mimeType: a.mimeType || 'image/png',
          data: a.data.length > 1_400_000 ? '' : a.data,
        }))
        .filter((a: any) => a.data);
      const meta = {
        status: r.status,
        durationMs: r.durationMs,
        truncated: !!r.truncated,
        stdout: typeof r.stdout === 'string' ? r.stdout : '',
        stderr: typeof r.stderr === 'string' ? r.stderr : '',
        result: typeof r.result === 'string' ? r.result : '',
        error: r.error ? { ename: r.error.ename, evalue: r.error.evalue, traceback: Array.isArray(r.error.traceback) ? r.error.traceback : [] } : undefined,
        images,
        kernelRestarted: !!r.kernelRestarted,
      };

      if (r.status === 'error' && r.error) {
        const traceback = Array.isArray(r.error.traceback) ? r.error.traceback.join('\n') : '';
        const brief = traceback ? traceback.split('\n').slice(-6).join('\n') : `${r.error.ename}: ${r.error.evalue}`;
        return {
          title: 'Python 执行出错',
          output: `代码执行出错：${r.error.ename}: ${r.error.evalue}\n${brief}\n（会话内核状态保留，可修改后重试）`,
          metadata: { python: meta },
        };
      }
      if (r.status === 'aborted') {
        return { title: 'Python 执行已中止', output: '执行已超时或中断（内核已打断，可重试或重启内核）', metadata: { python: meta } };
      }
      const parts: string[] = [];
      if (r.kernelRestarted) parts.push('<python_kernel_reset> 内核已重启，之前的变量/导入已丢失，请重新定义。</python_kernel_reset>');
      if (r.stdout) parts.push(r.stdout);
      if (r.result) parts.push(r.result);
      if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
      if (r.truncated) parts.push('...(输出已截断)');
      if ((r.attachments || []).length > 0) parts.push(`[生成 ${(r.attachments as any[]).length} 张图片]`);
      const output = parts.join('\n') || '(无输出)';
      return {
        title: 'Python 执行结果',
        output,
        metadata: { python: meta },
      };
    } catch (err) {
      return {
        title: 'Python 内核不可用',
        output: `内核调用失败：${(err as Error).message}（可用 mafw_python_restart 重启内核）`,
        metadata: {},
      };
    }
  },
};
