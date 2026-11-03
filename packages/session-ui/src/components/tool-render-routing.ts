// 工具 part 渲染路由（错误分支）：默认由 ToolErrorCard 接管 error part；
// 只有注册了 `handlesError` 自定义渲染器的工具才把 error 交给该卡。
//
// 解析顺序与 `resolveToolRender` 完全一致（原生名 > runtime 别名 > canonical >
// class 家族），首个命中的注册项决定结论；未命中的工具保持既有 ToolErrorCard。
import { CLASS_FAMILY, displayToolOf, TOOL_NAME_ALIASES, type PartLike } from "./parts-rules"
import { ToolRegistry } from "./tool-registry"

export interface ToolRoutingPart {
  type?: string
  tool?: string
  canonicalTool?: string
  toolClass?: string
  state?: { status?: string; error?: unknown }
}

/** True when the card that would render this part opts into error rendering. */
export function resolveToolHandlesError(part: ToolRoutingPart | null | undefined): boolean {
  const name = typeof part?.tool === "string" ? part.tool : ""
  if (!name) return false
  const alias = TOOL_NAME_ALIASES[name]
  const canonical = displayToolOf(part as PartLike)
  const family = typeof part?.toolClass === "string" && part.toolClass ? part.toolClass : undefined
  const candidates = [
    name,
    alias,
    canonical !== name ? canonical : undefined,
    family ? CLASS_FAMILY[family] : undefined,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (ToolRegistry.render(candidate)) return ToolRegistry.handlesError(candidate)
  }
  return false
}

/**
 * Error parts short-circuit to ToolErrorCard unless the resolved card opted
 * into error rendering. Non-error parts never take this branch.
 */
export function shouldRenderToolError(part: ToolRoutingPart | null | undefined): boolean {
  if (part?.type !== "tool") return false
  if (part.state?.status !== "error" || !part.state.error) return false
  return !resolveToolHandlesError(part)
}
