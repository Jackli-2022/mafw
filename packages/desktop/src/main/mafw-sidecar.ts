import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { connect } from "node:net"
import { app } from "electron"
import { MafwClient } from "@mafw/sdk"
import { write as writeLog } from "./logging"
import { probeMafwCli } from "./mafw-cli-probe"
import { planGatewayStart, type GatewayStartPlan } from "./mafw-gateway-plan"
import {
  negotiateGateway,
  type GatewayHealthSnapshot,
  type GatewayInstanceRecord,
  type GatewayReleaseExpectation,
  type GatewaySourcePreference,
} from "./gateway-handshake"
import { resolveGatewayEntry } from "./mafw-gateway-resolver"
import { readGatewayReleaseExpectation } from "./gateway-release-expectation"
import {
  gatewayInstanceRegistryRoot,
  readGatewayInstanceRecords,
  removeGatewayInstanceRecord,
  writeGatewayInstanceRecord,
} from "./gateway-instance-registry"
import {
  allowLegacyExternalOnce,
  consumeLegacyExternalOnce,
  readGatewaySourcePreference,
  writeGatewaySourcePreference,
} from "./gateway-source-preference"
import { waitForGatewayDown } from "./gateway-health"
import { getStore } from "./store"
import { CHANNEL } from "./constants"

export type GatewayState = "stopped" | "starting" | "ready" | "failed" | "conflict"

export interface GatewayQuarantineView {
  version: string
  payloadManifestSha256: string
  error: string
  failedAt: string
}

export type GatewayStatus = {
  state: GatewayState
  port: number | null
  url: string | null
  error: string | null
  spawnedByUs?: boolean
  source: GatewaySourcePreference | null
  expectedVersion: string | null
  actualVersion: string | null
  instanceId: string | null
  schemaEpoch: number | null
  distribution: string | null
  quarantine?: GatewayQuarantineView | null
}

type Listener = (state: GatewayState) => void

type EventPayload = {
  event: string
  data: unknown
}

type EventListener = (event: EventPayload) => void

type RunningProbe =
  | { kind: "none" }
  | { kind: "gateway"; health: GatewayHealthSnapshot; managedInstance: GatewayInstanceRecord | null }
  | { kind: "port-conflict" }

const stateListeners = new Set<Listener>()
const eventListeners = new Set<EventListener>()
const GATEWAY_URL = "http://127.0.0.1:3000"
const INSTANCE_ROOT = gatewayInstanceRegistryRoot()

let state: GatewayState = "stopped"
let port: number | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null
let spawnedByUs = false
let managedChild: ChildProcess | null = null
let managedRecord: GatewayInstanceRecord | null = null
let expected: GatewayReleaseExpectation | null = null
let actualHealth: GatewayHealthSnapshot | null = null
let sourcePreference: GatewaySourcePreference | null = null
let errorMessage: string | null = null
// Set by stopGateway() so an async child exit can distinguish intentional stop.
let expectedExit = false

function preferenceStore() {
  return getStore("mafw.gateway")
}

function notifyState(next: GatewayState) {
  writeLog("utility", `mafw gateway state -> ${next}`, { port, previousState: state }, "info")
  state = next
  for (const callback of stateListeners) callback(next)
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const client = new MafwClient(url)
    await client.project.current()
    return true
  } catch {
    return false
  }
}

function tcpReachable(host: string, targetPort: number, timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: targetPort })
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(true))
    socket.once("error", () => done(false))
  })
}

async function readGatewayHealth(url: string): Promise<GatewayHealthSnapshot | null> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    const health = await response.json() as GatewayHealthSnapshot
    try {
      await new MafwClient(url).project.current()
    } catch {
      return null
    }
    return health
  } catch {
    return null
  }
}

async function probeGatewayAt(targetPort = 3000): Promise<RunningProbe> {
  const url = `http://127.0.0.1:${targetPort}`
  const health = await readGatewayHealth(url)
  if (health) {
    const records = await readGatewayInstanceRecords(INSTANCE_ROOT, CHANNEL)
    const managedInstance = health.instanceId
      ? records.find((record) => record.instanceId === health.instanceId) ?? null
      : null
    return { kind: "gateway", health, managedInstance }
  }
  if (await tcpReachable("127.0.0.1", targetPort)) return { kind: "port-conflict" }
  return { kind: "none" }
}

/** Packaged apps ship the gateway under resources/gateway (see stage-gateway.ts). */
function resolveBundledEntry(): string | null {
  if (!app.isPackaged) return null
  const entry = join(process.resourcesPath, "gateway", "dist", "index.js")
  return existsSync(entry) ? entry : null
}

function resolveManagedEntry(): string | null {
  return app.isPackaged ? resolveBundledEntry() : resolveGatewayEntry()
}

function killProcess(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.platform === "win32") {
        execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, () => resolve())
      } else {
        process.kill(pid, "SIGTERM")
        resolve()
      }
    } catch {
      resolve()
    }
  })
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.removeListener("exit", finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    child.once("exit", finish)
  })
}

async function terminateManagedInstance(): Promise<boolean> {
  const child = managedChild
  const record = managedRecord
  if (!child && !record) return false
  expectedExit = true

  let killed = false
  if (child) {
    if (child.pid) await killProcess(child.pid)
    await waitForChildExit(child)
    killed = true
  } else if (record) {
    const probe = await probeGatewayAt(3000)
    const stillTheSameInstance = probe.kind === "gateway"
      && probe.health.instanceId === record.instanceId
    if (stillTheSameInstance) {
      await killProcess(record.pid)
      killed = true
    }
  }

  if (record) {
    await removeGatewayInstanceRecord(INSTANCE_ROOT, record)
  }
  managedChild = null
  managedRecord = null
  expectedExit = false
  return killed
}

async function spawnManagedGateway(
  entry: string,
  release: GatewayReleaseExpectation,
): Promise<{ child: ChildProcess; record: GatewayInstanceRecord }> {
  const instanceId = randomUUID()
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.MAFW_TAKEOVER
  delete env.MAFW_GATEWAY_PORT
  delete env.MAFW_SERVER_API_PORT
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: "1",
    MAFW_DESKTOP_MANAGED: "1",
    MAFW_DESKTOP_CHANNEL: CHANNEL,
    MAFW_DESKTOP_INSTANCE_ID: instanceId,
    MAFW_SERVER_API_PORT: "3000",
  })

  const child = spawn(process.execPath, [entry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  managedChild = child
  expectedExit = false
  const record: GatewayInstanceRecord = {
    instanceId,
    pid: child.pid ?? 0,
    channel: CHANNEL,
    gatewayVersion: release.gatewayVersion,
    schemaEpoch: release.schemaEpoch,
    startedAt: new Date().toISOString(),
    nonce: randomUUID(),
  }
  managedRecord = record
  if (record.pid > 0) await writeGatewayInstanceRecord(INSTANCE_ROOT, record)

  child.stdout?.on("data", (chunk) => writeLog("utility", `[gateway] ${String(chunk).trimEnd()}`, undefined, "info"))
  child.stderr?.on("data", (chunk) => writeLog("utility", `[gateway] ${String(chunk).trimEnd()}`, undefined, "warn"))
  child.on("error", (err) => {
    writeLog("utility", "managed gateway spawn error", { error: err.message }, "error")
    managedChild = null
    if (record.pid > 0) void removeGatewayInstanceRecord(INSTANCE_ROOT, record)
    managedRecord = null
    errorMessage = err.message
    notifyState("failed")
  })
  child.on("exit", (code) => {
    writeLog("utility", "managed gateway exited", { code, expectedExit }, code === 0 ? "info" : "warn")
    managedChild = null
    if (record.pid > 0) void removeGatewayInstanceRecord(INSTANCE_ROOT, record)
    if (managedRecord?.instanceId === record.instanceId) managedRecord = null
    if (expectedExit) {
      expectedExit = false
      return
    }
    if (state === "ready" || state === "starting") {
      errorMessage = `managed gateway exited (code=${code ?? "unknown"})`
      notifyState("failed")
    }
  })
  return { child, record }
}

function spawnCliDaemon(): boolean {
  try {
    writeLog("utility", "mafw starting external gateway via CLI", { port }, "info")
    execFile("mafw", ["daemon"], { shell: true, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        writeLog("utility", "mafw CLI daemon failed", { error: err.message, stderr: stderr?.trim() }, "error")
        errorMessage = err.message
        notifyState("failed")
        return
      }
      writeLog("utility", "mafw CLI daemon output", { stdout: stdout?.trim() }, "info")
    })
    return true
  } catch (err: any) {
    writeLog("utility", "mafw CLI exec failed", { error: err.message }, "error")
    errorMessage = err.message
    notifyState("failed")
    return false
  }
}

function pollUntilReady(url: string, mode: "managed" | "external", instanceId?: string): void {
  let attempts = 0
  const maxAttempts = 30

  healthInterval = setInterval(async () => {
    attempts += 1
    const health = await readGatewayHealth(url)
    if (health) {
      const handshake = negotiateGateway({
        mode,
        health,
        expected: expected!,
        expectedInstanceId: instanceId,
      })
      if (healthInterval) clearInterval(healthInterval)
      healthInterval = null
      if (!handshake.ok) {
        errorMessage = `gateway handshake failed: ${handshake.reason}`
        actualHealth = health
        notifyState("conflict")
        return
      }
      actualHealth = health
      port = 3000
      notifyState("ready")
      return
    }
    if (attempts >= maxAttempts) {
      if (healthInterval) clearInterval(healthInterval)
      healthInterval = null
      errorMessage = "Gateway failed to start within 30s"
      if (mode === "managed") {
        void terminateManagedInstance()
      }
      notifyState("failed")
    }
  }, 1000)
}

function conflict(plan: Extract<GatewayStartPlan, { mode: "conflict" }>, running: RunningProbe): void {
  errorMessage = plan.detail
  actualHealth = running.kind === "gateway" ? running.health : null
  port = running.kind === "none" ? null : 3000
  spawnedByUs = false
  notifyState("conflict")
}

export async function startGateway(): Promise<void> {
  if (state === "starting" || state === "ready") return

  sourcePreference = readGatewaySourcePreference(preferenceStore())
  const managedEntry = resolveManagedEntry()
  const releaseEntry = managedEntry
  if (!releaseEntry) {
    errorMessage = "no managed gateway release entry is available for handshake"
    notifyState("failed")
    return
  }

  try {
    expected = readGatewayReleaseExpectation(releaseEntry, CHANNEL)
  } catch (err: any) {
    errorMessage = err.message
    notifyState("failed")
    return
  }

  const running = await probeGatewayAt(3000)
  const cliProbe = sourcePreference === "external" ? await probeMafwCli() : { available: false as const, reason: "managed mode" }
  const legacyExternalOverride = sourcePreference === "external" && consumeLegacyExternalOnce()
  const plan = planGatewayStart({
    packaged: app.isPackaged,
    preference: sourcePreference,
    expected,
    bundledEntry: resolveBundledEntry(),
    managedEntry: app.isPackaged ? null : managedEntry,
    externalCli: cliProbe,
    running,
    legacyExternalOverride,
  })
  writeLog("utility", "mafw gateway start plan", {
    mode: plan.mode,
    preference: sourcePreference,
    running: running.kind,
    expected: expected.gatewayVersion,
  }, "info")

  if (plan.mode === "conflict") {
    conflict(plan, running)
    return
  }
  if (plan.mode === "failed") {
    errorMessage = plan.reason
    notifyState("failed")
    return
  }

  if (plan.mode === "managed" && plan.action === "adopt") {
    if (running.kind !== "gateway" || !running.managedInstance) {
      errorMessage = "managed instance registration disappeared during adoption"
      notifyState("failed")
      return
    }
    managedRecord = running.managedInstance
    spawnedByUs = false
    actualHealth = running.health
    port = 3000
    notifyState("ready")
    return
  }

  if (plan.mode === "external" && plan.transport === "url") {
    if (running.kind === "gateway") {
      actualHealth = running.health
      port = 3000
      spawnedByUs = false
      errorMessage = plan.warning === "legacy-unverified"
        ? "using an external gateway without verifiable version metadata for this session"
        : null
      notifyState("ready")
      return
    }
    errorMessage = "external gateway URL was selected but no running gateway was found"
    notifyState("failed")
    return
  }

  if (running.kind === "gateway" && plan.mode === "managed" && plan.action === "spawn") {
    writeLog("utility", "managed gateway replacement requested", {
      oldInstance: running.managedInstance?.instanceId ?? null,
      expected: expected.gatewayVersion,
    }, "info")
    await terminateManagedInstance()
    await waitForGatewayDown(() => checkHealth(GATEWAY_URL), { timeoutMs: 8000, intervalMs: 200 })
    if (await tcpReachable("127.0.0.1", 3000)) {
      errorMessage = "old managed gateway is still holding port 3000"
      notifyState("failed")
      return
    }
  }

  notifyState("starting")
  port = 3000
  spawnedByUs = plan.mode === "managed"

  if (plan.mode === "managed") {
    writeLog("utility", "mafw starting verified managed gateway", { entry: plan.entry }, "info")
    const { record } = await spawnManagedGateway(plan.entry, expected)
    pollUntilReady(GATEWAY_URL, "managed", record.instanceId)
    return
  }

  if (!spawnCliDaemon()) return
  pollUntilReady(GATEWAY_URL, "external")
}

export async function stopGateway(): Promise<void> {
  const liveUrl = port ? `http://127.0.0.1:${port}` : null
  const killed = await terminateManagedInstance()
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
  port = null
  spawnedByUs = false
  actualHealth = null
  errorMessage = null
  notifyState("stopped")
  if (liveUrl && killed) {
    await waitForGatewayDown(() => checkHealth(liveUrl), { timeoutMs: 8000, intervalMs: 200 })
  }
}

let restartInflight: Promise<void> | null = null

/** Stop the current managed child first, then start from the release payload.
 * External gateways are not killed; managed ownership is registration-based. */
export function restartGateway(): Promise<void> {
  if (restartInflight) return restartInflight
  restartInflight = (async () => {
    await stopGateway()
    await startGateway()
  })().finally(() => { restartInflight = null })
  return restartInflight
}

export function getGatewayStatus(): GatewayStatus {
  return {
    state,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    error: errorMessage ?? (state === "failed" ? "Gateway failed to start" : null),
    spawnedByUs,
    source: sourcePreference,
    expectedVersion: expected?.gatewayVersion ?? null,
    actualVersion: actualHealth?.gatewayVersion ?? null,
    instanceId: actualHealth?.instanceId ?? managedRecord?.instanceId ?? null,
    schemaEpoch: actualHealth?.schemaEpoch ?? expected?.schemaEpoch ?? null,
    distribution: actualHealth?.distribution ?? null,
  }
}

export function onGatewayStateChange(cb: Listener): () => void {
  stateListeners.add(cb)
  return () => stateListeners.delete(cb)
}

export function getGatewayPort(): number | null {
  return port
}

export function getGatewaySourcePreference(): GatewaySourcePreference {
  sourcePreference = readGatewaySourcePreference(preferenceStore())
  return sourcePreference
}

export function setGatewaySourcePreference(value: GatewaySourcePreference): GatewaySourcePreference {
  writeGatewaySourcePreference(preferenceStore(), value)
  sourcePreference = value
  return value
}

export function useLegacyExternalOnce(): void {
  allowLegacyExternalOnce()
}

export function resetGatewaySourcePreferenceForTests(): void {
  // Reserved for future injected tests; production never calls it.
}
