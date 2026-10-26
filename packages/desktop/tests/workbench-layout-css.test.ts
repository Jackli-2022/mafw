import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：三列主区（chat 定宽可拖 + 工作台吃剩余）。
// spec 2026-10-22-workbench-layout D1 / Builder 已决项：chat ≈340（280-480 可拖），工作台 = 剩余。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")
const shell = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "MafwShell.tsx"), "utf8")

describe("workbench 三列布局契约", () => {
  test("chat 面板 flush：无外边距/圆角/阴影（C 案：面板贴边，内容居中）", () => {
    const block = css.match(/\.mafw-chat \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("margin: 0")
    expect(block).toContain("border-radius: 0")
    expect(block).toContain("box-shadow: none")
  })
  test("chat 面板与工作台同底色（视觉同一层级）", () => {
    const block = css.match(/\.mafw-pane\[data-layout="chat"\] \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("background: var(--bg-base)")
  })
  test("chat 列可拖：main 为定位容器，分隔条绝对贴右缘", () => {
    const main = css.match(/\.mafw-main \{[\s\S]*?\}/)?.[0] ?? ""
    expect(main).toContain("position: relative")
    const handle = css.match(/\.mafw-chat-resize \{[\s\S]*?\}/)?.[0] ?? ""
    expect(handle).toContain("position: absolute")
    expect(handle).toContain("right: 0")
  })
  test("工作台吃剩余宽度（第三列 + flex）", () => {
    const slot = css.match(/\.mafw-dock-slot \{[\s\S]*?\}/)?.[0] ?? ""
    expect(slot).toContain("grid-column: 3")
    const wb = css.match(/\.mafw-workbench \{[\s\S]*?\}/)?.[0] ?? ""
    expect(wb).toContain("flex: 1")
  })
  test("MafwShell 接 defaultDockOpen + 绝对档位（旧 clampChatWidth 退役）", () => {
    expect(shell).toContain("defaultDockOpen")
    expect(shell).toContain("chatPxForDetent")
    expect(shell).not.toContain("clampChatWidth")
  })
})
