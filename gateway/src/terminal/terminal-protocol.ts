/**
 * MAFW terminal 协议（mafw-terminal/1）。
 *
 * 客户端（desktop/TUI/mobile）只实现本协议；原生 runtime 帧（opencode 的原始
 * 文本 + 0x00 前缀 meta）由适配器翻译，永不越过 gateway 边界。
 *
 * 帧词汇：
 *   client → gateway：{v:1,type:'input',data} / {v:1,type:'resize',cols,rows} / {v:1,type:'close',code?,reason?}
 *   gateway → client：{v:1,type:'output',data} / {v:1,type:'meta',event,payload?} / {v:1,type:'close',code,reason?}
 *
 * 版本不匹配或字段非法一律解析失败（fail-closed），由桥接层用 close 帧告知客户端。
 */
import { MAFW_TERMINAL_PROTOCOL } from '../runtime/pty';

export { MAFW_TERMINAL_PROTOCOL };
export const MAFW_TERMINAL_VERSION = 1 as const;

/** WebSocket close 码（4xxx = 应用自定义；与桌面既有 4404「终端已随服务重启关闭」共存）。 */
export const TERMINAL_CLOSE_CODES = {
  badFrame: 4400,
  unauthorized: 4401,
  unsupported: 4503,
  upstream: 4502,
} as const;

export interface TerminalInputFrame {
  v: 1;
  type: 'input';
  data: string;
}

export interface TerminalResizeFrame {
  v: 1;
  type: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalCloseFrame {
  v: 1;
  type: 'close';
  code: number;
  reason?: string;
}

export interface TerminalOutputFrame {
  v: 1;
  type: 'output';
  data: string;
}

export interface TerminalMetaFrame {
  v: 1;
  type: 'meta';
  event: string;
  payload?: unknown;
}

export type TerminalFrame =
  | TerminalInputFrame
  | TerminalResizeFrame
  | TerminalCloseFrame
  | TerminalOutputFrame
  | TerminalMetaFrame;

export interface TerminalConnectRequest {
  id: string;
  ticket: string;
}

const CONNECT_RE = /^\/api\/terminal\/sessions\/([^/?#]+)\/connect(?:\?|$)/;

export function encodeTerminalFrame(frame: TerminalFrame): string {
  return JSON.stringify(frame);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseFrame(value: any): TerminalFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.v !== MAFW_TERMINAL_VERSION) return null;
  switch (value.type) {
    case 'input':
      return typeof value.data === 'string' ? { v: 1, type: 'input', data: value.data } : null;
    case 'output':
      return typeof value.data === 'string' ? { v: 1, type: 'output', data: value.data } : null;
    case 'resize':
      return isPositiveInt(value.cols) && isPositiveInt(value.rows)
        ? { v: 1, type: 'resize', cols: value.cols, rows: value.rows }
        : null;
    case 'meta': {
      if (typeof value.event !== 'string' || !value.event) return null;
      return { v: 1, type: 'meta', event: value.event, ...(value.payload !== undefined ? { payload: value.payload } : {}) };
    }
    case 'close': {
      if (value.code !== undefined && !isPositiveInt(value.code)) return null;
      if (value.reason !== undefined && typeof value.reason !== 'string') return null;
      return {
        v: 1,
        type: 'close',
        code: value.code ?? 1000,
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
      };
    }
    default:
      return null;
  }
}

/** 解码客户端/服务端帧；非法输入返回 null（调用方 close(badFrame)）。 */
export function decodeTerminalFrame(raw: unknown): TerminalFrame | null {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString('utf8');
  else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
  else return null;
  try {
    return parseFrame(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 中性连接路径（不含票据——票据由 connect-ticket 单独签发）。 */
export function terminalConnectPath(id: string): string {
  return `/api/terminal/sessions/${encodeURIComponent(id)}/connect`;
}

/** 解析 WS upgrade URL；缺票据/缺 id/非法路径 → null。 */
export function matchTerminalConnectUrl(url: string): TerminalConnectRequest | null {
  const match = url.match(CONNECT_RE);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }
  if (!id) return null;
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(url.slice(queryIndex + 1));
  const ticket = params.get('ticket');
  if (!ticket) return null;
  return { id, ticket };
}
