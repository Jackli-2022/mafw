import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 标题零泄漏架构（spec §6.2-2 + 终审 Important #1）：
// 数据层（sessions()/store.session）保持 raw；格式化只发生在渲染面。
// 这样 tab 改名草稿 seed 的永远是原始标题，不会把「未命名 · 10月13日」持久化。

test("data layer stays raw: openSessionTab / retitleOpenTab do not format", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const open = shell.match(/const openSessionTab[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.doesNotMatch(open, /formatRailTitle\(/)
  assert.match(open, /title \|\| `Chat \$\{/)
  const retitle = shell.match(/retitleOpenTab: \(id, title\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""
  assert.doesNotMatch(retitle, /formatRailTitle\(/)
})

test("render surfaces format: SessionStrip tabs + ChatPane titlebar + WelcomeHome", () => {
  const strip = read("src/renderer/mafw/components/SessionStrip.tsx")
  const stripCalls = strip.match(/formatRailTitle\(/g) ?? []
  assert.ok(stripCalls.length >= 2, `tab label + overflow title, got ${stripCalls.length}`)
  // 改名草稿 seed 原始 s.title（数据层 raw，不需要额外转换）
  assert.match(strip, /setRenameDraft\(s\.title \|\| ""\)/)
  const chat = read("src/renderer/mafw/components/ChatPane.tsx")
  assert.match(chat, /formatRailTitle\(/)
  const welcome = read("src/renderer/mafw/components/WelcomeHome.tsx")
  assert.match(welcome, /formatRailTitle\(s\.title\)/)
})
