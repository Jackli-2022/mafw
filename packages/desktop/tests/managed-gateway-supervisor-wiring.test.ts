import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const sidecar = read("../src/main/mafw-sidecar.ts")
const ipc = read("../src/main/mafw-ipc.ts")
const preload = read("../src/preload/mafw-api.ts")
const preloadTypes = read("../src/preload/mafw-types.ts")
const main = read("../src/main/index.ts")

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
  assert.match(sidecar, /MAFW_GATEWAY_ORIGIN: app\.isPackaged \? "desktop-packaged" : "desktop-dev"/)
  assert.match(sidecar, /delete env\.MAFW_TAKEOVER/)
  assert.match(sidecar, /delete env\.MAFW_GATEWAY_PORT/)
  assert.match(sidecar, /delete env\.MAFW_SERVER_API_PORT/)
  assert.doesNotMatch(sidecar, /writeGatewayPidFile|clearGatewayPidFile|mafw-pid-file/)
})

test("startup probes ownership before planning and never adopts an unregistered gateway when packaged", () => {
  assert.match(sidecar, /const running = await probeRunningGateway\(\)/)
  assert.match(sidecar, /readGatewayDiscovery\(\)/)
  assert.match(sidecar, /healthMatchesDiscovery\(health, discovery\)/)
  assert.match(sidecar, /readGatewayInstanceRecords\(INSTANCE_ROOT, CHANNEL\)/)
  assert.match(sidecar, /preference: sourcePreference/)
  assert.match(sidecar, /running,/)
  // Dev attaches to an already-running gateway; packaged builds never do.
  assert.match(sidecar, /devAdoptRunningGateway: !app\.isPackaged && process\.env\.MAFW_DEV_ADOPT !== "0"/)
  assert.match(sidecar, /plan\.mode === "conflict"/)
  assert.match(sidecar, /plan\.action === "adopt"/)
})

test("packaged managed startup uses the verified lifecycle before replacing a child", () => {
  assert.match(sidecar, /prepareManagedSpawn\(/)
  assert.match(sidecar, /prepareManagedGateway\(\{/)
  assert.match(sidecar, /if \(!prepared\) return/)
  assert.match(sidecar, /recordManagedStartFailure\(\{/)
  assert.match(sidecar, /readQuarantine\(managedRoot\)/)
  const prepareAt = sidecar.indexOf("prepareManagedSpawn(plan.entry")
  assert.ok(
    prepareAt >= 0 && prepareAt < sidecar.indexOf("await terminateManagedInstance()", prepareAt),
    "new payload must stage before the running child is stopped",
  )
  assert.match(main, /configureManagedGatewayRoot\(join\(app\.getPath\("userData"\), "gateway"\)\)/)
})

test("managed stop awaits child exit and no longer writes a registry record", () => {
  assert.match(sidecar, /async function terminateManagedInstance/)
  assert.match(sidecar, /await waitForChildExit\(child\)/)
  assert.doesNotMatch(sidecar, /writeGatewayInstanceRecord/)
  assert.doesNotMatch(sidecar, /removeGatewayInstanceRecord\(INSTANCE_ROOT/)
  assert.match(sidecar, /await waitForGatewayDown\(\(\) => checkHealth\(liveUrl\)/)
  assert.match(sidecar, /restartInflight = \(async \(\) => \{\s*await stopGateway\(\)\s*await startGateway\(\)/)
})

test("status carries source, expected/actual versions and instance identity", () => {
  assert.match(sidecar, /source:\s*GatewaySourcePreference \| null/)
  assert.match(sidecar, /expectedVersion:\s*expected\?\.gatewayVersion \?\? null/)
  assert.match(sidecar, /actualVersion:\s*actualHealth\?\.gatewayVersion \?\? null/)
  assert.match(sidecar, /instanceId:\s*actualHealth\?\.instanceId \?\? managedRecord\?\.instanceId \?\? null/)
  assert.match(sidecar, /distribution:\s*actualHealth\?\.distribution \?\? null/)
  assert.match(sidecar, /attached:\s*attachment\.attached/)
  assert.match(sidecar, /attachedOrigin:\s*attachment\.attachedOrigin/)
  assert.match(sidecar, /canRestartWithLocalBuild:\s*restartDecision\.allowed/)
  assert.match(sidecar, /restartHint:\s*restartDecision\.hint/)
})

test("quit waits for the managed gateway and never uses the WSL-only stop callback", () => {
  assert.match(main, /const updater = setupAutoUpdater\(stopGateway\)/)
  assert.match(main, /createQuitCoordinator\(\{/)
  assert.match(main, /event\.preventDefault\(\)/)
  assert.match(main, /void quitCoordinator\.requestQuit\(\)/)
  assert.match(main, /Promise\.allSettled\(\[stopSidecars\(\), stopGateway\(\)\]\)/)
  assert.doesNotMatch(main, /setupAutoUpdater\(stopSidecars\)/)
  assert.doesNotMatch(sidecar, /installQuitHook|app\.on\("will-quit"/)
})

test("IPC and preload expose source switching and forced managed retry", () => {
  assert.match(ipc, /mafw-gateway-source-preference-get/)
  assert.match(ipc, /mafw-gateway-source-preference-set/)
  assert.match(ipc, /mafw-gateway-legacy-external-once/)
  assert.match(ipc, /mafw-gateway-retry-managed/)
  assert.match(ipc, /mafw-gateway-restart-local/)
  assert.match(preload, /getSourcePreference:/)
  assert.match(preload, /setSourcePreference:/)
  assert.match(preload, /useExternalOnce:/)
  assert.match(preload, /retryManaged:/)
  assert.match(preload, /restartLocal:/)
  assert.match(preloadTypes, /retryManaged: \(opts\?: \{ force\?: boolean \}\) => Promise<GatewayStatus>/)
  assert.match(preloadTypes, /restartLocal: \(\) => Promise<GatewayStatus>/)
})
