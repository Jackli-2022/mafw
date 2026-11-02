import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// B1 子代理跳转 + v2.1.0 工具身份归一化接线契约（source-level）。
// Task 10：多形状读取收敛到摄取层（desktop ingest/*），渲染只读规范形。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("task card + v2.1.0 tool identity wiring", () => {
  test("ingestion owns tool normalization for history and live", () => {
    const parts = read("src/renderer/mafw/ingest/parts.ts")
    expect(parts).toContain("canonicalToolPart")
    expect(parts).toContain("toolNameOf")
    expect(read("src/renderer/mafw/sse/chat-reducers.ts")).toContain("normalizeToolPart")
    expect(read("src/renderer/mafw/ingest/messages.ts")).toContain("canonicalToolPart")
    expect(read("src/renderer/mafw/sse/handlers/chat-stream.ts")).toContain("ingestLivePart")
    expect(read("src/renderer/mafw/components/ChatPane.tsx")).toContain("ingestHistoryPage")
  })

  test("background detection reads name fallback", () => {
    const bg = read("src/renderer/mafw/background-detect.ts")
    expect(bg).toContain("toolNameOf")
    expect(bg).toContain('"task"')
  })

  test("session-ui task card reads canonical metadata/agent fields + aliases", () => {
    const part = read("../session-ui/src/components/message-part.tsx")
    expect(part).toContain("partMetadata().sessionID")
    expect(part).toContain("isTaskPart(part())")
    expect(part).toContain("props.metadata.sessionID")
    expect(part).toContain("input.agent")
    expect(part).toContain("TOOL_NAME_ALIASES")
    expect(part).toContain("onNavigate={")
    const canonical = read("../session-ui/src/components/tool-canonical.ts")
    expect(canonical).toContain("isTaskPart")
    expect(canonical).toContain("TOOL_NAME_ALIASES")
    const rules = read("../session-ui/src/components/parts-rules.ts")
    expect(rules).toContain('subagent: "task"')
    expect(rules).toContain('shell: "bash"')
  })

  test("failed task card wires onNavigate", () => {
    const errorCard = read("../session-ui/src/components/tool-error-card.tsx")
    expect(errorCard).toContain("onNavigate?:")
    expect(errorCard).toContain("split.onNavigate?.()")
    expect(errorCard).toContain("shouldInvokeNavigate")
  })
})
