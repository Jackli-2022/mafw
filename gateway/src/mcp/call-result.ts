/**
 * CallTool 出口单一映射（2026-10-22 spec §5.3 执行面 / G4）。
 *
 * 两个 transport（sse-transport / streamable-endpoint）的 CallToolRequestSchema
 * handler 共用此出口：handler 返回形状（含 structuredContent）直达 MCP
 * CallToolResult——MCP spec 要求双载荷向后兼容（content 恒在）。
 */
import type { ToolHandler } from '../types';

export type ToolHandlerResult = Awaited<ReturnType<ToolHandler>>;

/** 出口映射：handler 可直接给 structuredContent；否则把 JSON text content
 *  自动提升为 object 形 structuredContent（数组/标量包一层），与 tool-registry
 *  的 generic outputSchema 配对。文本非 JSON 时保持原样。 */
export function toCallToolResult(handlerResult: ToolHandlerResult): ToolHandlerResult {
  if (!handlerResult || handlerResult.structuredContent !== undefined) return handlerResult;
  const text = Array.isArray(handlerResult.content)
    ? handlerResult.content.find((p: any) => p?.type === 'text' && typeof p.text === 'string')?.text
    : undefined;
  if (typeof text !== 'string') return handlerResult;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return handlerResult; }
  const structuredContent =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : Array.isArray(parsed)
        ? { items: parsed }
        : { value: parsed };
  return { ...handlerResult, structuredContent };
}
