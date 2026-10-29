import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) => readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "components", file), "utf8")

test("TerminalView consumes only preload terminal API", () => {
  const src = read("TerminalView.tsx")
  assert.match(src, /window\.api\.mafw\.terminal\.sessions\.attach/)
  assert.match(src, /window\.api\.mafw\.terminal\.sessions\.input/)
  assert.match(src, /window\.api\.mafw\.terminal\.sessions\.resize/)
  assert.match(src, /buildTerminalMenu/)
  assert.doesNotMatch(src, /from "node:/)
  assert.doesNotMatch(src, /from "ssh2"/)
  assert.doesNotMatch(src, /from "electron"/)
})
