import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：三列主区（chat 定宽可拖 + 工作台吃剩余）。
// spec 2026-10-22-workbench-layout D1 / Builder 已决项：chat ≈340（280-480 可拖），工作台 = 剩余。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")
const shell = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "MafwShell.tsx"), "utf8")

describe("workbench 三列布局契约", () => {
  test("chat 列可拖：main 为定位容器，分隔条绝对贴右缘", () => {
    const main = css.match(/\.mafw-main \{[\s\S]*?\}/)?.[0] ?? ""
    expect(main).toContain("position: relative")
    const handle = css.match(/\.mafw-chat-resize \{[\s\S]*?\}/)?.[0] ?? ""
    expect(handle).toContain("position: absolute")
    expect(handle).toContain("right: 0")
  })
  test("RightDock 支持填充模式（正常布局吃剩余宽度，overlay 仍用固定宽）", () => {
    const dock = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "components", "RightDock.tsx"), "utf8")
    expect(dock).toContain("fill")
    expect(dock).toContain("100%")
  })
  test("MafwShell 接 defaultDockOpen/defaultDockTab（默认打开+文件 tab）", () => {
    expect(shell).toContain("defaultDockOpen")
    expect(shell).toContain("defaultDockTab")
    expect(shell).toContain("clampChatWidth")
  })
})
