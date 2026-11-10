/**
 * 中性 PTY 通道契约（terminal.pty surface）。
 *
 * gateway 只认识本文件的中性词汇：会话 CRUD、连接描述符、中性入站事件。
 * 原生 PTY 端点、connect-token 与原生帧格式（原始文本 / 0x00 前缀 meta）
 * 全部属于 runtime 适配器；gateway 不得按 runtime 名分支，也不得把原生
 * URL / 原生票据泄漏给客户端。
 *
 * 设计依据：docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §7.3
 *
 * Plan 6 Task 3：类型迁至 `@mafw/runtime-contract`（`channels.ts`）；本模块
 * 只保留旧导出路径（re-export shim）与 gateway-only 的协议版本常量。
 */

/** MAFW 终端协议版本标识（帧词汇见 terminal/terminal-protocol.ts）。 */
export const MAFW_TERMINAL_PROTOCOL = 'mafw-terminal/1';

export type {
  RuntimePtyCreateOpts,
  RuntimePtyInfo,
  RuntimePtyConnection,
  RuntimePtyInbound,
  RuntimePtyChannel,
} from '@mafw/runtime-contract';
