// v2.1.0 tool part 名称归一化：历史/live 的 part 只带 `name`（如 "subagent"、
// "shell"），没有 `tool`。session-ui 的卡片注册表、后台检测、canonical 解析
// 都读 `tool`——在 store 入口补一次，三个消费面同时恢复。
// 纯函数、幂等：已有 tool 原样返回（保持对象引用）。

export function toolNameOf(part: any): string | undefined {
  if (!part || part.type !== "tool") return undefined
  if (typeof part.tool === "string" && part.tool) return part.tool
  if (typeof part.name === "string" && part.name) return part.name
  return undefined
}

export function normalizeToolPart(part: any): any {
  if (!part || part.type !== "tool") return part
  const name = toolNameOf(part)
  if (!name || part.tool === name) return part
  return { ...part, tool: name }
}
