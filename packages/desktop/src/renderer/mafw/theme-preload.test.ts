import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const preload = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "public", "oc-theme-preload.js"),
  "utf8",
)

// 主题 preload 必须与 MafwShell 读写同一 localStorage 键（mafw-theme）：
// 旧实现无条件写 data-theme="oc-2"（读 opencode-theme-id/opencode-color-scheme 上游遗留键），
// 在 MafwShell mount 前使「跟随系统」媒体查询死代码化（html:not([data-theme]) 不命中）→
// 亮 OS 首帧闪暗色；且 preload 与 app 状态源不一致是主题信号错位的温床。
describe("theme preload 与 MafwShell 同源", () => {
  test("读取 mafw-theme 键", () => {
    expect(preload).toContain('localStorage.getItem("mafw-theme")')
  })
  test("无保存值时不写死 data-theme（保留跟随系统媒体查询）", () => {
    expect(preload).not.toMatch(/dataset\.theme\s*=\s*themeId/)
    expect(preload).toContain("removeAttribute")
  })
})
