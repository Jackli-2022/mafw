import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import type { Configuration } from "electron-builder"

const packageDir = new URL("../", import.meta.url)

test("the installer no longer ships or runs a global npm gateway updater", async () => {
  const module = await import("../electron-builder.config.ts?installer-health=1")
  const config = module.default as Configuration
  const resources = (config.extraResources ?? []) as Array<{ from: string; to: string }>

  assert.equal(resources.some((entry) => entry.to === "gateway-update/"), false)
  assert.equal(existsSync(new URL("gateway-update/update-global-gateway.cjs", packageDir)), false)
  assert.equal(existsSync(new URL("resources/installer.nsh", packageDir)), false)
})

test("no custom NSIS include remains after removing the npm hook", async () => {
  const module = await import("../electron-builder.config.ts?installer-include=1")
  const config = module.default as Configuration
  assert.equal(config.nsis?.include, undefined)
})

test("the desktop test glob no longer references gateway-update", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", packageDir), "utf8"))
  assert.doesNotMatch(pkg.scripts.test, /gateway-update/)
})
