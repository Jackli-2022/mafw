import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("LeftDock: formatted titles, raw rename seed", () => {
  const src = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.match(src, /formatRailTitle\(node\.title\)/)
  // 重命名草稿必须用原始 node.title（数据层 raw），禁止格式化串持久化
  const rename = src.match(/const startRename = \(node: SessionNode\) => \{([^}]*)\}/)?.[1] ?? ""
  assert.match(rename, /node\.title/)
  assert.doesNotMatch(rename, /formatRailTitle/)
})

test("LeftDock: project name fallback at three sites; chevron after name", () => {
  const src = read("src/renderer/mafw/components/LeftDock.tsx")
  const calls = src.match(/railProjectName\(/g) ?? []
  assert.ok(calls.length >= 3, `expected >=3 railProjectName sites, got ${calls.length}`)
  // switcher：name 在 caret 之前
  const nameAt = src.indexOf("mafw-rail-switcher-name")
  const caretAt = src.indexOf("mafw-rail-switcher-caret")
  assert.ok(nameAt > 0 && caretAt > 0 && nameAt < caretAt, "chevron after project name")
})

test("LeftDock: quiet date groups (no count render, no line, text-4)", () => {
  const src = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.doesNotMatch(src, /mafw-rail-date-count/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.doesNotMatch(css, /\.mafw-rail-date-group::after/)
  assert.doesNotMatch(css, /\.mafw-rail-date-count/)
  const group = css.match(/\.mafw-rail-date-group \{([^}]*)\}/)?.[1] ?? ""
  assert.match(group, /color: var\(--text-4\)/)
})
