// canonical 翻译层消费面（A 切片）：渲染四级解析 + read 域多 key + class 家族兜底。
// 纯逻辑轻依赖（tool-registry / parts-rules / basic-tool），bun test 可直接导入；
// gateway enrich 的 additive 字段 part.canonicalTool / part.toolClass 在此消费。
import { displayToolOf } from "./parts-rules"
import { ToolRegistry } from "./tool-registry"
import { GenericTool } from "./basic-tool"
import type { ToolComponent } from "./tool-registry"

/** toolClass → 代表内建卡名（未注册名按语义家族兜底渲染）。 */
export const CLASS_FAMILY: Record<string, string> = {
  shell: "bash",
  readonly: "read",
  search: "grep",
  "file-edit": "edit",
  subagent: "task",
  web: "webfetch",
  plan: "todowrite",
}

function toolClassOfPart(part: any): string | undefined {
  const v = part?.toolClass
  return typeof v === "string" && v ? v : undefined
}

/** 四级渲染解析（纯函数可测）：原生名 > canonical > class 家族 > GenericTool。 */
export function resolveToolRender(part: any): ToolComponent {
  const canonical = displayToolOf(part)
  const family = toolClassOfPart(part)
  return (
    ToolRegistry.render(part.tool)
    ?? (canonical && canonical !== part.tool ? ToolRegistry.render(canonical) : undefined)
    ?? (family ? ToolRegistry.render(CLASS_FAMILY[family]) : undefined)
    ?? GenericTool
  )
}

/** read 域三套键（opencode filePath / pi path / Claude file_path）——commandTextOf 多 key 先例。 */
export function readPathInput(input: any): string | undefined {
  const v = input?.filePath ?? input?.path ?? input?.file_path
  return typeof v === "string" && v ? v : undefined
}
