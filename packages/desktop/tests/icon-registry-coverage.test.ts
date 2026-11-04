// 图标注册表覆盖契约（2026-11-04，用户报「项目资源页按钮全是加号」）：
// ButtonV2 / IconButtonV2 的 `icon=` 走 v2 图标注册表（@mafw/ui/v2/icon），
// 未注册的名字会静默回退成 plus——按钮形状全变加号。这里扫全部渲染层用法，
// 任何 ButtonV2 icon 名不在 v2 注册表里就算失败（新增图标或改用法都必须同步）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const v2IconSource = read("../../ui/src/v2/components/icon.tsx")

/** v2 注册表的键（icon.tsx 里 `name: { viewBox, body }` 的条目）。 */
export function v2IconNames(source: string): string[] {
  const names: string[] = []
  for (const line of source.split("\n")) {
    const match = line.match(/^\s{2}(?:"([a-z0-9-]+)"|([a-z0-9-]+)):\s*\{/)
    if (match) names.push(match[1] ?? match[2])
  }
  return names
}

/** 渲染层所有 ButtonV2 / IconButtonV2 的 `icon="name"` 用法（含多行标签）。 */
export function buttonIconUsages(root: string): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) { walk(full); continue }
      if (!entry.endsWith(".tsx")) continue
      const text = readFileSync(full, "utf8")
      // 只在同一个开标签内匹配（[^<] 防止跨到 DockEmpty 等相邻组件）。
      for (const match of text.matchAll(/<(ButtonV2|IconButtonV2)\b[^<]*?\bicon="([a-z0-9-]+)"/g)) {
        out.push({ name: match[2], file: full })
      }
    }
  }
  walk(root)
  return out
}

const rendererRoot = new URL("../src/renderer", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")

test("every ButtonV2 icon name exists in the v2 icon registry", () => {
  const names = new Set(v2IconNames(v2IconSource))
  assert.ok(names.size > 40, "v2 icon registry parse produced too few names")
  const missing = buttonIconUsages(rendererRoot)
    .filter((usage) => !names.has(usage.name))
    .map((usage) => `${usage.name} (${usage.file})`)
  assert.deepEqual(missing, [], `ButtonV2 icon names missing from v2 registry (render as plus):\n${missing.join("\n")}`)
})
