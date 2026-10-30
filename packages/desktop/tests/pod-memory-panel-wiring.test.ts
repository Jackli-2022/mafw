import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodMemoryPanel.tsx", import.meta.url), "utf8")

test("memory panel reads and writes the three pod files", () => {
  assert.match(src, /readMemoryFile/)
  assert.match(src, /writeMemory/)
  assert.match(src, /showToastV2/)
  assert.match(src, /POD/)
  assert.match(src, /MEMORY/)
  assert.match(src, /GLOSSARY/)
  assert.match(src, /mafw-pod-memory/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
