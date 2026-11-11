/**
 * Phase D1 Task 3a: Python kernel REST 面（registry dispatch 接线）。
 *
 *   POST /api/python/execute   — 会话作用域持久内核执行
 *   POST /api/python/restart   — 重启会话内核（状态丢失）
 *   GET  /api/python/status    — 内核状态
 *
 * loopback-only（与 legacy 分支语义逐字等价）；deps 注入可单测。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { isLoopbackAddr } from '../core/auth';
import type { SessionKernels } from '../python/kernel-service';
import { QuotaExceededError } from '../resources/quotas';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';

export interface PythonRouteDeps {
  kernels: () => SessionKernels | null | undefined;
}

export function attachPythonRoutes(registry: RouteRegistry, deps: PythonRouteDeps): void {
  registry.attachHandler('python.execute', async (req, res) => {
    if (!isLoopbackAddr(req.socket?.remoteAddress || '')) { forbidden(res); return; }
    try {
      const kernels = serviceOr503(res, deps);
      if (!kernels) return;
      const body = JSON.parse(await readRouteBody(req));
      const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
      const code = typeof body?.code === 'string' ? body.code : '';
      if (!sessionID || !code) { json(res, 400, { error: 'sessionID and code are required' }); return; }
      const kernel = kernels.get(sessionID);
      const result = await kernel.execute(code, {
        timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
      });
      if (result.truncated) {
        const removed = 'output truncated';
        result.stdout += `\n\n... (${removed}, 已截断)`;
      }
      json(res, 200, result);
    } catch (err: any) {
      // E4-6: 并发帽拒绝是容量问题（429），不是内核故障（502）。
      if (err instanceof QuotaExceededError) {
        json(res, 429, {
          error: err.message,
          code: 'quota_exceeded',
          resource: err.resource,
          limit: err.limit,
          current: err.current,
        });
        return;
      }
      json(res, 502, { error: err?.message || String(err) });
    }
  });

  registry.attachHandler('python.restart', async (req, res) => {
    if (!isLoopbackAddr(req.socket?.remoteAddress || '')) { forbidden(res); return; }
    try {
      const kernels = serviceOr503(res, deps);
      if (!kernels) return;
      const body = JSON.parse(await readRouteBody(req));
      const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
      if (!sessionID) { json(res, 400, { error: 'sessionID is required' }); return; }
      await kernels.restart(sessionID);
      json(res, 200, { ok: true });
    } catch (err: any) {
      json(res, 500, { error: err?.message || String(err) });
    }
  });

  registry.attachHandler('python.status', async (req, res) => {
    if (!isLoopbackAddr(req.socket?.remoteAddress || '')) { forbidden(res); return; }
    try {
      const kernels = serviceOr503(res, deps);
      if (!kernels) return;
      const sessionID = new URL(req.url || '', 'http://localhost').searchParams.get('sessionID') || '';
      if (!sessionID) { json(res, 400, { error: 'sessionID is required' }); return; }
      json(res, 200, kernels.status(sessionID));
    } catch (err: any) {
      json(res, 500, { error: err?.message || String(err) });
    }
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function forbidden(res: ServerResponse): void {
  res.writeHead(403);
  res.end(JSON.stringify({ error: 'forbidden' }));
}

function serviceOr503(res: ServerResponse, deps: PythonRouteDeps): SessionKernels | null {
  const kernels = deps.kernels();
  if (!kernels) {
    json(res, 503, { error: 'PyKernel not initialized' });
    return null;
  }
  return kernels;
}

export type { IncomingMessage };
