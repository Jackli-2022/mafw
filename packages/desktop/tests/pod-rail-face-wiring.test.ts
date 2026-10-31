import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodRailFace.tsx", import.meta.url), "utf8")
const dock = readFileSync(new URL("../src/renderer/mafw/components/LeftDock.tsx", import.meta.url), "utf8")

test("pod rail face is read-only: no composer, sections in 待办-first order", () => {
  // 输入区已移出左栏（spec 2026-10-30-pod-left-rail 交付后调整）
  assert.doesNotMatch(src, /SelectV2/)
  assert.doesNotMatch(src, /SwitchV2|from "@mafw\/ui\/v2\/switch-v2"/)
  assert.doesNotMatch(src, /<textarea/)
  assert.doesNotMatch(src, /applyReadlineKey/)
  // 顺序：待我处理 → 班底 → （goal）→ 最近
  const todo = src.indexOf("待我处理")
  const roster = src.indexOf("班底")
  const recent = src.indexOf("最近")
  assert.ok(todo > 0 && roster > todo && recent > roster, "sections must be 待我处理 → 班底 → 最近")
})

test("pod rail face keeps the read-only contract", () => {
  assert.match(src, /mafw-pod-rail-face/)
  assert.match(src, /buildRecentMessages/)
  assert.match(src, /onOpenMessage/)
  assert.match(src, /mafw-pod-rail-message/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /\btitle=/)
})

test("left dock renders the pod face with read-only props", () => {
  assert.match(dock, /PodRailFace/)
  assert.match(dock, /face === "pod"/)
  assert.match(dock, /props\.face !== "notes" && props\.face !== "pod"/)
  assert.match(dock, /podDetail\?: PodDetail \| null/)
  assert.doesNotMatch(dock, /podDetail\?: any/)
  assert.match(dock, /onPodOpenMessage/)
  assert.doesNotMatch(dock, /onPodSend/)
})

test("pod face has a header, loading and error states", () => {
  assert.match(src, /mafw-pod-rail-head/)
  assert.match(src, /onRefresh/)
  assert.match(src, /加载中/)
  assert.match(src, /props\.error/)
  assert.match(src, /podStatusLabel/)
})
