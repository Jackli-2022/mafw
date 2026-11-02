import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Task 10 组件级守卫：回合错误/中止只读摄取层产物（规范 `{kind,message}`），
 * 渲染组件不得回退到 step-finish 或 runtime 错误类名/原生字段。
 */
describe("session turn canonical error wiring", () => {
  const turn = readFileSync(join(HERE, "session-turn.tsx"), "utf8")

  test("uses the shared abort/error guards", () => {
    expect(turn).toContain("isAbortMessageError(m.error)")
    expect(turn).toContain("errorCardText(m.error)")
  })

  test("does not fall back to step-finish or runtime error names", () => {
    expect(turn).not.toContain('part.type === "step-finish"')
    expect(turn).not.toContain('part?.type === "step-finish"')
    expect(turn).not.toContain("MessageAbortedError")
    expect(turn).not.toContain("(last as any).stopReason")
  })

  test("renders the error card only when text exists", () => {
    expect(turn).toContain('<Show when={errorText()}>')
    expect(turn).not.toContain("<Show when={error()}>")
  })
})
