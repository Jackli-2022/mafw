import test from "node:test"
import assert from "node:assert/strict"
import { formatRailTitle, railProjectName } from "./rail-display"

test("formatRailTitle：ISO 兜底 → 未命名 · 日期段", () => {
  assert.equal(formatRailTitle("New session - 2026-10-13T06:28:19.923Z"), "未命名 · 10月13日")
  assert.equal(formatRailTitle("New session - 2026-09-03T02:54:36.009Z"), "未命名 · 9月3日")
})

test("formatRailTitle：空 → 未命名；普通标题原样；幂等", () => {
  assert.equal(formatRailTitle(""), "未命名")
  assert.equal(formatRailTitle("  "), "未命名")
  assert.equal(formatRailTitle(null), "未命名")
  assert.equal(formatRailTitle("New conversation"), "未命名") // runtime 空会话占位
  assert.equal(formatRailTitle("New Conversation"), "未命名")
  assert.equal(formatRailTitle("大脑视觉符号与LLM视觉眼调研"), "大脑视觉符号与LLM视觉眼调研")
  const once = formatRailTitle("New session - 2026-10-13T06:28:19.923Z")
  assert.equal(formatRailTitle(once), once)
})

test("railProjectName：basename；退化名按 isCurrent 分流", () => {
  assert.equal(railProjectName("C:\\work\\opencode-plugin-mafw", true), "opencode-plugin-mafw")
  assert.equal(railProjectName("C:/work/look", false), "look")
  assert.equal(railProjectName(".", true), "当前项目")
  assert.equal(railProjectName(".", false), "未命名项目")
  assert.equal(railProjectName("", true), "当前项目")
  assert.equal(railProjectName(null, false), "未命名项目")
  assert.equal(railProjectName("C:\\work\\look\\", true), "当前项目")
})


