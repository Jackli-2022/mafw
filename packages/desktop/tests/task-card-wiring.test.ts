import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// B1 子代理跳转 + v2.1.0 tool 名称归一化接线契约（source-level）。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("task card + v2.1.0 tool identity wiring", () => {
  test("desktop 归一化模块存在且被 live/history 入口调用", () => {
    const toolPart = read("src/renderer/mafw/tool-part.ts")
    expect(toolPart).toContain("normalizeToolPart")
    expect(toolPart).toContain("toolNameOf")
    expect(read("src/renderer/mafw/sse/chat-reducers.ts")).toContain("normalizeToolPart")
    expect(read("src/renderer/mafw/MafwShell.tsx")).toContain("normalizeToolPart(")
    expect(read("src/renderer/mafw/components/ChatPane.tsx")).toContain("normalizeToolPart(")
  })

  test("background detection reads name fallback", () => {
    const bg = read("src/renderer/mafw/background-detect.ts")
    expect(bg).toContain("toolNameOf")
    expect(bg).toContain('"task"')
  })

  test("session-ui task card accepts sessionID metadata + aliases subagent/shell", () => {
    const part = read("../session-ui/src/components/message-part.tsx")
    expect(part).toContain("taskChildSessionID(partMetadata())")
    expect(part).toContain("isTaskTool(part().tool)")
    expect(part).toContain("taskChildID() ?")
    expect(part).toContain("taskChildSessionID(props.metadata)")
    expect(part).toContain("TOOL_NAME_ALIASES")
    expect(part).toContain("onNavigate={")
    const canonical = read("../session-ui/src/components/tool-canonical.ts")
    expect(canonical).toContain("TOOL_NAME_ALIASES")
    expect(canonical).toContain("subagent: \"task\"")
    expect(canonical).toContain("shell: \"bash\"")
  })

  test("failed task card wires onNavigate", () => {
    const errorCard = read("../session-ui/src/components/tool-error-card.tsx")
    expect(errorCard).toContain("onNavigate?:")
    expect(errorCard).toContain("split.onNavigate?.()")
  })
})
