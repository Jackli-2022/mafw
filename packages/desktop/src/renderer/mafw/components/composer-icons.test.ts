import { describe, expect, test } from "bun:test"
import { icons } from "@mafw/ui/icon"

// Composer 工具条用到的全部 v1 图标名。
// 回归背景：sparkles 只存在于 v2 图标表，v1 Icon 渲染成空 <use>（静默空白）。
const COMPOSER_ICONS = [
  "paperclip",
  "console",
  "subagent",
  "review",
  "volume",
  "microphone",
  "stop",
  "shield",
  "sliders",
  "bullet-list",
  "terminal",
  // titlebar / chips / jump / send（glyph 统一批次）
  "close",
  "branch",
  "arrow-left",
  "arrow-up",
  "arrow-down-to-line",
  "file",
] as const

describe("composer toolbar icons", () => {
  test("工具条用到的图标名都存在于 v1 图标表", () => {
    for (const name of COMPOSER_ICONS) {
      expect(name in icons).toBe(true)
    }
  })

  test("图标 body 非空（含 svg 图元）", () => {
    for (const name of COMPOSER_ICONS) {
      const body = icons[name as keyof typeof icons]
      expect(body.length).toBeGreaterThan(0)
      expect(body).toMatch(/<(path|rect|circle|g)\b/)
    }
  })
})
