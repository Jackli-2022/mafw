// trajectory-tree：把 turn 内平铺事件组装为 call tree（v6 §5）。
// 栈式配对：*_start 压栈，*_end 出栈闭合并填 duration/error；同栈顶下的事件
// （如子代理 tool）自然嵌套为 children；未配对节点保留为进行态（durationMs null）。
export type CallNode = {
  key: string
  kind: "tool" | "reasoning" | "lifecycle" | "other"
  label: string
  error: boolean
  durationMs: number | null
  children: CallNode[]
}

const KIND_OF: Record<string, CallNode["kind"]> = {
  tool_start: "tool",
  reasoning_start: "reasoning",
}

export function buildCallTree(events: any[]): CallNode[] {
  const roots: CallNode[] = []
  const stack: CallNode[] = []
  const top = () => stack[stack.length - 1]
  const push = (n: CallNode) => {
    const t = top()
    if (t) t.children.push(n)
    else roots.push(n)
  }
  const nameOf = (e: any) => e.toolName ?? e.tool_name ?? e.model ?? e.agent

  for (const e of events ?? []) {
    const type: string = e.eventType ?? e.event_type ?? ""
    if (type.endsWith("_start") && KIND_OF[type]) {
      const node: CallNode = {
        key: String(e.seq ?? roots.length),
        kind: KIND_OF[type],
        label: nameOf(e) ?? type.replace(/_start$/, ""),
        error: false,
        durationMs: null,
        children: [],
      }
      push(node)
      stack.push(node)
      continue
    }
    if (type.endsWith("_end")) {
      const base = type.replace(/_end$/, "")
      // 从栈顶向下找同名未闭合节点（容错乱序）。
      for (let i = stack.length - 1; i >= 0; i--) {
        const n = stack[i]
        if ((nameOf(e) && n.label === nameOf(e)) || n.kind === base) {
          n.error = (e.toolState ?? e.tool_state) === "error" || !!e.error
          n.durationMs = e.durationMs ?? e.duration_ms ?? null
          stack.length = i // 弹出该节点及其上层
          break
        }
      }
      continue
    }
    push({
      key: String(e.seq ?? roots.length),
      kind: "other",
      label: nameOf(e) ?? type,
      error: (e.toolState ?? e.tool_state) === "error" || !!e.error,
      durationMs: e.durationMs ?? e.duration_ms ?? null,
      children: [],
    })
  }
  return roots
}
