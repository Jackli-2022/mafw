import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const config = read("../src/renderer/mafw/pages/Config.tsx")
const mainIpc = read("../src/main/mafw-ipc.ts")
const preloadTypes = read("../src/preload/mafw-types.ts")
const preloadApi = read("../src/preload/mafw-api.ts")

test("Config renders gateway ownership and source diagnostics from the model", () => {
  assert.match(config, /gatewayConfigView/)
  assert.match(config, /gatewayConflictGuidance/)
  assert.match(config, /gwStatus\(\)\?\.source/)
  assert.match(config, /gwStatus\(\)\?\.actualVersion/)
  assert.match(config, /gwStatus\(\)\?\.expectedVersion/)
  assert.match(config, /gwStatus\(\)\?\.instanceId/)
  assert.match(config, /gwStatus\(\)\?\.schemaEpoch/)
  assert.match(config, /gwStatus\(\)\?\.quarantine/)
  assert.match(config, /gwStatus\(\)\?\.attached/)
  assert.match(config, /gwStatus\(\)\?\.attachedOrigin/)
  assert.match(config, /gwStatus\(\)\?\.canRestartWithLocalBuild/)
  assert.match(config, /gwStatus\(\)\?\.restartHint/)
  assert.match(config, /gateway\.restartLocal\(\)/)
})

test("Config switches source explicitly and supports quarantine retry", () => {
  assert.match(config, /gateway\.getSourcePreference\(\)/)
  assert.match(config, /gateway\.setSourcePreference\(/)
  assert.match(config, /gateway\.useExternalOnce\(\)/)
  assert.match(config, /gateway\.retryManaged\(\{ force: true \}\)/)
  assert.match(config, /仅本次使用未验证外部 gateway/)
  assert.match(config, /切换为受管 gateway/)
  assert.match(config, /切换为外部 gateway/)

  const start = config.indexOf("const useLegacyExternalOnce")
  const end = config.indexOf("const retryQuarantinedGateway", start)
  const onceBlock = config.slice(start, end)
  assert.match(onceBlock, /gateway\.useExternalOnce\(\)/)
  assert.doesNotMatch(onceBlock, /setSourcePreference\(/)
})

test("Desktop restart no longer writes the gateway self-update token", () => {
  assert.doesNotMatch(config, /gateway\.update\(\)/)
  assert.doesNotMatch(config, /更新 Gateway（自更新）/)
  assert.doesNotMatch(mainIpc, /buildUpdateToken|atomicWriteToken|mafw-gateway-update/)
  assert.doesNotMatch(preloadTypes, /update: \(\) => Promise<\{ ok: boolean; error\?: string \}>/)
  assert.doesNotMatch(preloadApi, /mafw-gateway-update/)
})

test("Config can install an already-downloaded desktop update without mixing gateway state", () => {
  assert.match(config, /window\.api\.updater\.subscribe/)
  assert.match(config, /window\.api\.updater\.install\(\)/)
  assert.match(config, /重启以更新/)
})
