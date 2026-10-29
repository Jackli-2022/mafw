import { z } from 'zod';

const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
export const POD_BASE = `http://127.0.0.1:${PORT}`;

export interface PodToolCtx {
  sessionID: string;
  abort?: AbortSignal;
}

export interface PodTool {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute(args: any, ctx: PodToolCtx): Promise<unknown>;
}

export async function podRequest(
  path: string,
  init: RequestInit,
  ctx: PodToolCtx,
): Promise<any> {
  const res = await fetch(`${POD_BASE}${path}`, { ...init, signal: ctx.abort });
  let body: any = {};
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err: any = new Error(body?.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function resolvePodId(ctx: PodToolCtx, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const session = await podRequest(`/api/sessions/${encodeURIComponent(ctx.sessionID)}`, { method: 'GET' }, ctx);
  const directory = session?.directory ?? session?.info?.directory;
  if (!directory) throw new Error('session directory unavailable');
  const detail = await podRequest(`/api/projects/${encodeURIComponent(directory)}/pod`, { method: 'GET' }, ctx);
  const podId = detail?.pod?.id;
  if (!podId) throw new Error('pod id unavailable');
  return podId;
}

export function toolError(title: string, err: any): unknown {
  const status = err?.status ? `HTTP ${err.status} ` : '';
  return {
    title,
    output: `${title}: ${status}${err?.message ?? err}`,
    isError: true,
    metadata: err?.status ? { status: err.status } : {},
  };
}
