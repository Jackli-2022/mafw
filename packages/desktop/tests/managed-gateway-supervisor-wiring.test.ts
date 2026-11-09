import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const sidecar = read("../src/main/mafw-sidecar.ts")
const ipc = read("../src/main/mafw-ipc.ts")
const preload = read("../src/preload/mafw-api.ts")
const preloadTypes = read("../src/preload/mafw-types.ts")

test("managed entry resolves packaged resources or the repository gateway", () => {
  assert.match(sidecar, /import \{ resolveGatewayEntry \} from "\.\/mafw-gateway-resolver"/)
  assert.match(sidecar, /function resolveManagedEntry\(\)/)
  assert.match(sidecar, /app\.isPackaged \? resolveBundledEntry\(\) : resolveGatewayEntry\(\)/)
})

test("managed spawn pins port and identity and never writes the CLI pid file", () => {
  assert.match(sidecar, /MAFW_SERVER_API_PORT: "3000"/)
  assert.match(sidecar, /MAFW_DESKTOP_MANAGED: "1"/)
  assert.match(sidecar, /MAFW_DESKTOP_CHANNEL: CHANNEL/)
  assert.match(sidecar, /MAFW_DESKTOP_INSTANCE_ID: instanceId/)
  assert.match(sidecar, /delete env\.MAFW_TAKEOVER/)
  assert.match(sidecar, /delete env\.MAFW_GATEWAY_PORT/)
  assert.match(sidecar, /delete env\.MAFW_SERVER_API_PORT/)
  assert.doesNotMatch(sidecar, /writeGatewayPidFile|clearGatewayPidFile|mafw-pid-file/)
})

test("startup probes ownership before planning and never adopts an unregistered gateway", () => {
  assert.match(sidecar, /const running = await probeGatewayAt\(3000\)/)
  assert.match(sidecar, /readGatewayInstanceRecords\(INSTANCE_ROOT, CHANNEL\)/)
  assert.match(sidecar, /preference: sourcePreference/)
  assert.match(sidecar, /running,/)
  assert.match(sidecar, /plan\.mode === "conflict"/)
  assert.match(sidecar, /plan\.action === "adopt"/)
})

test("managed stop awaits child exit and removes its registration", () => {
  assert.match(sidecar, /async function terminateManagedInstance/)
  assert.match(sidecar, /await waitForChildExit\(child\)/)
  assert.match(sidecar, /await removeGatewayInstanceRecord\(INSTANCE_ROOT, record\)/)
  assert.match(sidecar, /await waitForGatewayDown\(\(\) => checkHealth\(liveUrl\)/)
  assert.match(sidecar, /restartInflight = \(async \(\) => \{\s*await stopGateway\(\)\s*await startGateway\(\)/)
})

test("status carries source, expected/actual versions and instance identity", () => {
  assert.match(sidecar, /source:\s*GatewaySourcePreference \| null/)
  assert.match(sidecar, /expectedVersion:\s*expected\?\.gatewayVersion \?\? null/)
  assert.match(sidecar, /actualVersion:\s*actualHealth\?\.gatewayVersion \?\? null/)
  assert.match(sidecar, /instanceId:\s*actualHealth\?\.instanceId \?\? managedRecord\?\.instanceId \?\? null/)
  assert.match(sidecar, /distribution:\s*actualHealth\?\.distribution \?\? null/)
})

test("IPC and preload expose source switching and forced managed retry", () => {
  assert.match(ipc, /mafw-gateway-source-preference-get/)
  assert.match(ipc, /mafw-gateway-source-preference-set/)
  assert.match(ipc, /mafw-gateway-legacy-external-once/)
  assert.match(ipc, /mafw-gateway-retry-managed/)
  assert.match(preload, /getSourcePreference:/)
  assert.match(preload, /setSourcePreference:/)
  assert.match(preload, /useExternalOnce:/)
  assert.match(preload, /retryManaged:/)
  assert.match(preloadTypes, /retryManaged: \(opts\?: \{ force\?: boolean \}\) => Promise<GatewayStatus>/)
})
