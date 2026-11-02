/**
 * 中性 PTY 通道契约（terminal.pty surface）。
 *
 * gateway 只认识本文件的中性词汇：会话 CRUD、连接描述符、中性入站事件。
 * 原生 PTY 端点、connect-token 与原生帧格式（原始文本 / 0x00 前缀 meta）
 * 全部属于 runtime 适配器；gateway 不得按 runtime 名分支，也不得把原生
 * URL / 原生票据泄漏给客户端。
 *
 * 设计依据：docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §7.3
 */

/** MAFW 终端协议版本标识（帧词汇见 terminal/terminal-protocol.ts）。 */
export const MAFW_TERMINAL_PROTOCOL = 'mafw-terminal/1';

export interface RuntimePtyCreateOpts {
  /** 会话/工作区目录（PTY 归属，与 session directory 同规则）。 */
  directory: string;
  /** PTY 起始 cwd；缺省 = directory。 */
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export interface RuntimePtyInfo {
  id: string;
  title?: string;
  status?: 'running' | 'exited' | 'unknown';
  cwd?: string;
}

export interface RuntimePtyConnection {
  /** runtime 原生 WebSocket URL（只在 gateway 进程内使用）。 */
  url: string;
  /** 连接所需的原生头（如认证）。 */
  headers?: Record<string, string>;
}

/** 原生载荷 → 中性入站事件。 */
export type RuntimePtyInbound =
  | { kind: 'output'; data: string }
  | { kind: 'meta'; event: string; payload?: unknown }
  | { kind: 'close'; code?: number; reason?: string }
  | { kind: 'ignore' };

/**
 * PTY 生命周期通道。
 *
 * 全部方法可选缺席 = 不支持（`supported:false` + 中性 503），绝不伪造 PTY。
 * `decodeInbound` / `encodeInput` 是原生帧翻译的逃逸口：缺省实现把字符串/字节
 * 当作 UTF-8 output、把客户端 input 原样发送；适配器可覆盖以吸收原生 meta 帧。
 */
export interface RuntimePtyChannel {
  create(opts: RuntimePtyCreateOpts): Promise<{ id: string }>;
  connect(opts: { id: string; directory?: string }): Promise<RuntimePtyConnection>;
  resize(opts: { id: string; directory?: string; cols: number; rows: number }): Promise<void>;
  remove(opts: { id: string; directory?: string }): Promise<void>;
  /** 可选：runtime 侧会话列表（缺省时 gateway 只回本进程创建的会话）。 */
  list?(opts?: { directory?: string }): Promise<RuntimePtyInfo[]>;
  /** 可选：原生 socket 载荷 → 中性入站事件。 */
  decodeInbound?(data: unknown): RuntimePtyInbound[];
  /** 可选：MAFW input → 原生 socket 发送载荷（缺省原样发送文本）。 */
  encodeInput?(data: string): unknown;
}
