import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = join(here, "..", "package.json")
const require = createRequire(import.meta.url)

test("ssh2 is a production dependency", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  assert.equal(typeof pkg.dependencies.ssh2, "string")
})

test("ssh2 resolves for the Electron main process", () => {
  const entry = require.resolve("ssh2")
  assert.match(entry.replace(/\\/g, "/"), /node_modules\/ssh2\/(lib\/index\.js|index\.js)$/)
  const mod = require("ssh2")
  assert.equal(typeof mod.Client, "function")
})

test("built main bundle keeps ssh2 external (when out/ exists)", () => {
  const out = join(here, "..", "out", "main", "index.js")
  if (!existsSync(out)) return
  const src = readFileSync(out, "utf8")
  assert.match(src, /ssh2/)
})
