// Phase 4 / 4.7 decision guard: chat part rendering stays host-only.
//
// The evaluation in docs/research/2026-11-13-chat-part-renderer-evaluation.md
// defers a declarative `ui.dataPartCards` slot. Until that slot exists, plugin
// modules must not reach into the generic part registry: `PART_MAPPING` and
// `registerPartComponent` are renderer-internal, not a plugin API. Tool cards
// keep using ToolRegistry through the host proxy in PluginToolCard.tsx.
import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = import.meta.dirname

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry)) continue
    files.push(path)
  }
  return files
}

test("plugin modules never register chat part components", () => {
  const offenders = sourceFiles(ROOT).filter((file) => {
    const source = readFileSync(file, "utf8")
    return source.includes("registerPartComponent") || /\bPART_MAPPING\b/.test(source)
  })
  expect(offenders).toEqual([])
})
