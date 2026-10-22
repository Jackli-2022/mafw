/**
 * CallTool 出口单一映射（2026-10-22 spec §5.3 执行面 / G4）。
 *
 * 两个 transport（sse-transport / streamable-endpoint）的 CallToolRequestSchema
 * handler 共用此出口：handler 返回形状（含 structuredContent）直达 MCP
 * CallToolResult——MCP spec 要求双载荷向后兼容（content 恒在）。
 */
import type { ToolHandler } from '../types';

export type ToolHandlerResult = Awaited<ReturnType<ToolHandler>>;

/** 恒等映射（含 structuredContent 透传）——单一出口的意义是两 transport 不再各自内联拼装。 */
export function toCallToolResult(handlerResult: ToolHandlerResult): ToolHandlerResult {
  return handlerResult;
}
