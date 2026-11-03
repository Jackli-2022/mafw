/**
 * Shared plumbing for the Creator tools (`mafw_plugin_inspect` today, the
 * manager tool later).
 *
 * Two rules live here so every Creator tool behaves the same:
 *
 * - the gateway is reached over loopback HTTP on the configured API port;
 * - every request carries a hard 5s timeout composed with the caller's abort
 *   signal, and non-2xx bodies surface as readable errors instead of a silent
 *   `{}`.
 *
 * Nothing here performs approvals or writes: the manager tool owns those.
 */
import { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 5000;

/** Loopback gateway base URL (`MAFW_SERVER_API_PORT` wins over the legacy name). */
export function pluginGatewayBaseUrl(): string {
  const port = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
  return `http://127.0.0.1:${port}`;
}

/**
 * Native approval input forwarded by the host tool pipeline.
 *
 * `always` is intentionally required: a Creator mutation asks for the exact
 * operation only, never for a reusable allow rule.
 *
 * `metadata.forceHuman` is the gateway approval hook's existing contract
 * (`gateway/src/core/approval/hook.ts`): `auto` mode and internal sessions
 * auto-answer permission prompts, so a prompt that must reach a human carries
 * the flag and the policy ring steps aside.
 */
export interface PluginToolApproval {
  permission: string;
  patterns: string[];
  always: string[];
  metadata?: { [key: string]: unknown };
}

/**
 * Tool executor context shared by the Creator tools.
 *
 * `ask` is supplied by the host pipeline when it supports native approvals;
 * absence must be treated as "cannot ask" (fail closed), not "allowed".
 */
export interface PluginToolContext {
  sessionID: string;
  abort?: AbortSignal;
  directory?: string;
  agent?: string;
  ask?: (input: PluginToolApproval) => Promise<void>;
}

export interface PluginTool<TArgs = any> {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute(args: TArgs, ctx: PluginToolContext): Promise<unknown>;
}

interface ComposedSignal {
  signal: AbortSignal;
  dispose: () => void;
}

/** Caller abort + hard timeout, whichever fires first. */
function composeSignal(ctx: PluginToolContext, timeoutMs: number, label: string): ComposedSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  // Do not keep a test/dev process alive for an idle timer.
  (timer as any)?.unref?.();

  const outer = ctx.abort;
  const onAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

function describeAbort(signal: AbortSignal, ctx: PluginToolContext, label: string): Error {
  const reason = (signal as any).reason;
  if (reason instanceof Error) return reason;
  return new Error(
    ctx.abort?.aborted ? `${label} aborted by caller` : `${label} aborted`,
  );
}

async function readBody(res: any): Promise<any> {
  if (typeof res?.json === 'function') {
    try { return await res.json(); } catch { /* fall through to text */ }
  }
  if (typeof res?.text === 'function') {
    try { return await res.text(); } catch { /* ignore */ }
  }
  return undefined;
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  ctx: PluginToolContext,
): Promise<unknown> {
  const label = `${method} ${path}`;
  if (ctx.abort?.aborted) throw new Error(`${label} aborted by caller`);

  const { signal, dispose } = composeSignal(ctx, DEFAULT_TIMEOUT_MS, label);
  let res: any;
  try {
    res = await fetch(`${pluginGatewayBaseUrl()}${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal,
    });
  } catch (err: any) {
    if (signal.aborted) throw describeAbort(signal, ctx, label);
    throw new Error(`${label} failed: ${err?.message ?? String(err)}`);
  } finally {
    dispose();
  }

  const payload = await readBody(res);
  if (!res?.ok) {
    const detail = typeof payload === 'string'
      ? payload.trim().slice(0, 300)
      : typeof payload?.error === 'string'
        ? payload.error
        : '';
    const err: any = new Error(`${label} failed: HTTP ${res?.status}${detail ? ` ${detail}` : ''}`);
    err.status = res?.status;
    throw err;
  }
  return payload ?? null;
}

/** GET one gateway endpoint (JSON response; readable errors on non-2xx). */
export function pluginGatewayGet(path: string, ctx: PluginToolContext): Promise<unknown> {
  return request('GET', path, undefined, ctx);
}

/** POST one gateway endpoint with a JSON body. */
export function pluginGatewayPost(
  path: string,
  body: unknown,
  ctx: PluginToolContext,
): Promise<unknown> {
  return request('POST', path, body, ctx);
}
