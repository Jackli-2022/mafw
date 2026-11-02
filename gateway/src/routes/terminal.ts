/**
 * 中性 terminal REST 门面。
 *
 * gateway 只做：loopback 门 → surface 门（terminal.pty）→ TerminalService →
 * JSON。原生 PTY URL / 原生票据 / 原生帧全部在 runtime adapter；响应形状
 * 只含 MAFW DTO 与 mafw-terminal/1 协议标识。
 *
 * WS 升级不在此文件（index.ts 的 upgrade 路由按 path 分流）。
 */
import * as http from 'http';
import { isLoopbackAddr } from '../core/auth';
import type { RuntimeAccess } from '../runtime/runtime-access';
import {
  TerminalService,
  TerminalTicketError,
  TerminalUnsupportedError,
  type TerminalListResult,
} from '../terminal/terminal-service';
import { MAFW_TERMINAL_PROTOCOL } from '../terminal/terminal-protocol';

export interface TerminalRouteDeps {
  service: TerminalService;
  /** canonical surface gate（terminal.pty）；缺省 null = 由 service 自行判定。 */
  access?: Pick<RuntimeAccess, 'can'> | null;
  /** 测试注入；缺省 isLoopbackAddr。 */
  isLoopback?: (addr: string) => boolean;
}

const MAX_BODY_BYTES = 64 * 1024;

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: any) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY_BYTES) return;
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

async function bodyOf(req: http.IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function directoryOf(url: string): string | undefined {
  const index = url.indexOf('?');
  if (index < 0) return undefined;
  const value = new URLSearchParams(url.slice(index + 1)).get('directory');
  return value && value.trim() ? value : undefined;
}

function unsupported(res: http.ServerResponse): void {
  json(res, 503, { error: 'terminal PTY is not supported by the active runtime', supported: false });
}

export async function handleTerminal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: TerminalRouteDeps,
): Promise<boolean> {
  const isSessions = /^\/api\/terminal\/sessions(?:\?|$)/.test(url);
  const ticketMatch = url.match(/^\/api\/terminal\/sessions\/([^/?#]+)\/connect-ticket(?:\?|$)/);
  const sessionMatch = url.match(/^\/api\/terminal\/sessions\/([^/?#]+)(?:\?|$)/);
  if (!isSessions && !ticketMatch && !sessionMatch) return false;

  const loopback = deps.isLoopback ?? isLoopbackAddr;
  const remote = (req.socket as any)?.remoteAddress ?? '';
  if (!loopback(remote)) {
    json(res, 403, { error: 'terminal endpoints are loopback-only' });
    return true;
  }

  const supported = deps.access ? deps.access.can('terminal.pty') : deps.service.supports();

  try {
    if (ticketMatch && req.method === 'POST') {
      if (!supported) {
        unsupported(res);
        return true;
      }
      const id = decodeURIComponent(ticketMatch[1] ?? '');
      const body = await bodyOf(req);
      const directory = typeof body?.directory === 'string' && body.directory.trim()
        ? body.directory
        : directoryOf(url) ?? '';
      const ticket = deps.service.issueTicket({ id, directory });
      json(res, 200, ticket);
      return true;
    }

    if (isSessions && req.method === 'GET') {
      const result: TerminalListResult = supported
        ? await deps.service.list({ directory: directoryOf(url) })
        : { protocol: MAFW_TERMINAL_PROTOCOL, supported: false, sessions: [] };
      json(res, 200, result);
      return true;
    }

    if (isSessions && req.method === 'POST') {
      if (!supported) {
        unsupported(res);
        return true;
      }
      const body = await bodyOf(req);
      if (typeof body?.directory !== 'string' || !body.directory.trim()) {
        json(res, 400, { error: 'directory is required' });
        return true;
      }
      const created = await deps.service.create({
        directory: body.directory,
        ...(typeof body.cwd === 'string' && body.cwd ? { cwd: body.cwd } : {}),
        ...(typeof body.cols === 'number' ? { cols: body.cols } : {}),
        ...(typeof body.rows === 'number' ? { rows: body.rows } : {}),
        ...(typeof body.title === 'string' && body.title ? { title: body.title } : {}),
      });
      json(res, 200, { protocol: MAFW_TERMINAL_PROTOCOL, id: created.id });
      return true;
    }

    if (sessionMatch && req.method === 'DELETE') {
      if (!supported) {
        unsupported(res);
        return true;
      }
      await deps.service.remove(decodeURIComponent(sessionMatch[1] ?? ''), directoryOf(url));
      json(res, 200, { ok: true });
      return true;
    }

    json(res, 405, { error: 'method not allowed' });
    return true;
  } catch (err: any) {
    if (err instanceof TerminalUnsupportedError) {
      unsupported(res);
      return true;
    }
    if (err instanceof TerminalTicketError) {
      json(res, err.status, { error: err.message });
      return true;
    }
    json(res, 502, { error: 'terminal request failed' });
    return true;
  }
}
