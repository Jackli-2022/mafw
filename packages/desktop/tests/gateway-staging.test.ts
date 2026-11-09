import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  GATEWAY_ASSET_PROFILES,
  gatewayAssetPlan,
} from "../../../scripts/gateway-package-assets.mjs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const repoRoot = new URL("../../../", import.meta.url).pathname
const gatewayRoot = new URL("../../../gateway/", import.meta.url).pathname

test("desktop and global profiles describe the same shipped assets", () => {
  const desktop = gatewayAssetPlan({ repoRoot, gatewayRoot, profile: "desktop" })
  const global = gatewayAssetPlan({ repoRoot, gatewayRoot, profile: "global" })

  assert.deepEqual(desktop.map((entry) => entry.to), [
    "dist",
    "voice_sidecars",
    "skills",
    "scripts/setup-pykernel.mjs",
    "scripts/office",
  ])
  assert.deepEqual(global.map((entry) => entry.to), [
    "gateway/dist",
    "bin/mafw.js",
    "gateway/voice_sidecars",
    "skills",
    "gateway/scripts/setup-pykernel.mjs",
    "gateway/scripts/office",
  ])
  assert.deepEqual(GATEWAY_ASSET_PROFILES.desktop, ["dist", "voice_sidecars", "skills", "scripts"])
})

test("every desktop non-node_modules asset exists in the global profile", () => {
  const global = gatewayAssetPlan({ repoRoot, gatewayRoot, profile: "global" })
  const globalSources = new Set(global.map((entry) => entry.from))
  const desktop = gatewayAssetPlan({ repoRoot, gatewayRoot, profile: "desktop" })
  for (const entry of desktop) {
    assert.equal(globalSources.has(entry.from), true, `${entry.to} missing from global profile`)
  }
  assert.equal([...desktop, ...global].some((entry) => entry.to.includes("node_modules")), false)
})

test("staging copies the lockfile verbatim and uses npm ci", () => {
  const staging = read("../scripts/stage-gateway.ts")
  assert.match(staging, /gatewayAssetPlan/)
  assert.match(staging, /package-lock\.json/)
  assert.match(staging, /npm", \["ci", "--omit=dev"/)
  assert.doesNotMatch(staging, /dependencies: gatewayPkg\.dependencies/)
  assert.doesNotMatch(staging, /"\s*install",\s*"--omit=dev"/)
})

test("the gateway manifest keeps optional dependencies and the repo requires Node 22+", () => {
  const gatewayPkg = JSON.parse(read("../../../gateway/package.json"))
  const rootPkg = JSON.parse(read("../../../package.json"))
  assert.equal(typeof gatewayPkg.optionalDependencies?.["kokoro-js"], "string")
  assert.equal(rootPkg.engines?.node, ">=22")
})
