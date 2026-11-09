import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { connect } from "node:net"
import { app } from "electron"
import { MafwClient } from "@mafw/sdk"
import { write as writeLog } from "./logging"
import { probeMafwCli } from "./mafw-cli-probe"
import { planGatewayStart, type GatewayStartPlan } from "./mafw-gateway-plan"
import { planManagedGatewaySpawn } from "./managed-gateway-spawn"
import { resolveGatewayAttachment } from "./gateway-attachment"
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
  clearSessionSourcePreference,
  consumeLegacyExternalOnce,
  hasLegacyExternalSession,
  safeReadGatewaySourcePreference,
  useLegacyExternalSession,
  writeGatewaySourcePreference,
} from "./gateway-source-preference"
import { waitForGatewayDown } from "./gateway-health"
import { getStore } from "./store"
import { CHANNEL } from "./constants"
import {
  parseGatewayReleaseManifest,
  type GatewayReleaseManifest,
} from "./gateway-release-manifest"
import { stopRegisteredReplacement } from "./gateway-managed-replacement"
import {
  prepareManagedGateway,
  recordManagedStartFailure,
  type ManagedLifecycleResult,
} from "./gateway-managed-lifecycle"
import {
  readPreviousPointer,
  readQuarantine,
  type ManagedPointer,
} from "./gateway-managed-store"
import { readFile } from "node:fs/promises"

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
  /** Ready, but using a gateway this desktop did not spawn (handshake passed). */
  attached: boolean
  /** `standalone` / `desktop-managed`, or null when the gateway did not report one. */
  attachedOrigin: string | null
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
let managedRoot: string | null = null
let managedRelease: GatewayReleaseManifest | null = null
let forceManagedRetryOnce = false
// Set by stopGateway() so an async child exit can distinguish intentional stop.
let expectedExit = false

export function configureManagedGatewayRoot(root: string): void {
  managedRoot = root
}

function resolveManagedRoot(): string {
  if (!managedRoot) {
    managedRoot = join(app.getPath("userData"), "gateway")
  }
  return managedRoot
}

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
    MAFW_DESKTOP_MANAGED: "1",
    MAFW_DESKTOP_CHANNEL: CHANNEL,
    MAFW_DESKTOP_INSTANCE_ID: instanceId,
    MAFW_SERVER_API_PORT: "3000",
  })

  const plan = planManagedGatewaySpawn({
    packaged: app.isPackaged,
    execPath: process.execPath,
    nodeBin: process.env.MAFW_NODE_BIN || process.env.npm_node_execpath,
    entry,
    env,
  })
  const child = spawn(plan.command, plan.args, {
    env: plan.env,
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

function pollUntilReady(
  url: string,
  mode: "managed" | "external",
  instanceId?: string,
  onGiveUp?: (error: string) => Promise<void>,
  handshakeExpected: GatewayReleaseExpectation | null = expected,
): void {
  let attempts = 0
  const maxAttempts = 30

  healthInterval = setInterval(async () => {
    attempts += 1
    const health = await readGatewayHealth(url)
    if (health) {
      const handshake = negotiateGateway({
        mode,
        health,
        expected: handshakeExpected!,
        expectedInstanceId: instanceId,
      })
      if (healthInterval) clearInterval(healthInterval)
      healthInterval = null
      if (!handshake.ok) {
        errorMessage = `gateway handshake failed: ${handshake.reason}`
        actualHealth = health
        if (mode === "managed") {
          await terminateManagedInstance()
          if (onGiveUp) {
            await onGiveUp(errorMessage)
            return
          }
        }
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
      const failure = "Gateway failed to start within 30s"
      errorMessage = failure
      if (mode === "managed") {
        await terminateManagedInstance()
        if (onGiveUp) {
          await onGiveUp(failure)
          return
        }
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

async function readReleaseManifestFromDir(dir: string): Promise<GatewayReleaseManifest> {
  const raw = JSON.parse(await readFile(join(dir, "release-manifest.json"), "utf8"))
  return parseGatewayReleaseManifest(raw)
}

async function handleManagedStartFailure(error: string): Promise<void> {
  if (!app.isPackaged || !managedRelease) {
    errorMessage = error
    notifyState("failed")
    return
  }
  const root = resolveManagedRoot()
  const previous = readPreviousPointer(root)
  let previousRelease: GatewayReleaseManifest | null = null
  let schemaChanged = true
  if (previous) {
    try {
      previousRelease = await readReleaseManifestFromDir(join(root, "versions", previous.versionDir))
      schemaChanged = previousRelease.schemaEpoch !== managedRelease.schemaEpoch
    } catch {
      previousRelease = null
      schemaChanged = true
    }
  }

  const failure = await recordManagedStartFailure({
    managedRoot: root,
    release: managedRelease,
    error,
    previousAvailable: !!previous,
    schemaChanged,
    deps: {},
  })
  if (failure.blocked) {
    errorMessage = `${error}; gateway data schema changed, so automatic rollback is unsafe`
    notifyState("conflict")
    return
  }
  if (!failure.restartPointer || !previousRelease) {
    errorMessage = `${error}; no previous gateway payload is available`
    notifyState("conflict")
    return
  }

  const pointer: ManagedPointer = failure.restartPointer
  const fallbackDir = join(root, "versions", pointer.versionDir)
  const fallbackEntry = join(fallbackDir, "dist", "index.js")
  try {
    const fallbackExpected = readGatewayReleaseExpectation(fallbackEntry, CHANNEL)
    notifyState("starting")
    port = 3000
    spawnedByUs = true
    const { record } = await spawnManagedGateway(fallbackEntry, fallbackExpected)
    errorMessage = `${error}; running previous gateway ${previousRelease.gatewayVersion}`
    pollUntilReady(GATEWAY_URL, "managed", record.instanceId, async (retryError) => {
      errorMessage = `${retryError}; previous gateway payload also failed`
      notifyState("failed")
    }, fallbackExpected)
  } catch (fallbackError: any) {
    errorMessage = `${error}; previous gateway restart failed: ${fallbackError?.message ?? fallbackError}`
    notifyState("failed")
  }
}

async function prepareManagedSpawn(entry: string, forceRetry: boolean): Promise<string | null> {
  const resourcesRoot = dirname(dirname(entry))
  const result: ManagedLifecycleResult = await prepareManagedGateway({
    resourcesRoot,
    managedRoot: resolveManagedRoot(),
    expected: expected!,
    canReplaceRunning: true,
    forceRetry,
    deps: {},
  })
  if (result.kind === "start") {
    try {
      managedRelease = await readReleaseManifestFromDir(resourcesRoot)
    } catch {
      managedRelease = null
    }
    return result.entry
  }
  if (result.kind === "quarantined") {
    errorMessage = `gateway ${result.version} is quarantined: ${result.error}`
    notifyState("conflict")
    return null
  }
  if (result.kind === "blocked") {
    errorMessage = "gateway schema epoch changed; blocking automatic start and rollback"
    notifyState("conflict")
    return null
  }
  errorMessage = result.reason
  notifyState("failed")
  return null
}

export async function startGateway(): Promise<void> {
  if (state === "starting" || state === "ready") return

  const forceManagedRetry = forceManagedRetryOnce
  forceManagedRetryOnce = false
  sourcePreference = safeReadGatewaySourcePreference(preferenceStore(), (err) => writeLog("utility", "gateway preference unreadable; falling back to managed", { error: String(err) }, "warn"))
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
  const legacyExternalOverride = sourcePreference === "external"
    && (hasLegacyExternalSession() || consumeLegacyExternalOnce())
  const plan = planGatewayStart({
    packaged: app.isPackaged,
    preference: sourcePreference,
    expected,
    bundledEntry: resolveBundledEntry(),
    managedEntry: app.isPackaged ? null : managedEntry,
    externalCli: cliProbe,
    running,
    legacyExternalOverride,
    // Dev convenience by default; MAFW_DEV_ADOPT=0 forces the repo gateway so
    // gateway-side changes can be exercised against a running global daemon.
    devAdoptRunningGateway: !app.isPackaged && process.env.MAFW_DEV_ADOPT !== "0",
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

  let preparedManagedEntry = plan.mode === "managed" ? plan.entry : null
  if (plan.mode === "managed" && plan.action === "spawn" && app.isPackaged) {
    const prepared = await prepareManagedSpawn(plan.entry, forceManagedRetry)
    if (!prepared) return
    preparedManagedEntry = prepared
  }

  if (plan.mode === "managed" && plan.action === "adopt") {
    if (running.kind !== "gateway") {
      errorMessage = "gateway disappeared during adoption"
      notifyState("failed")
      return
    }
    if (plan.instanceId) {
      if (!running.managedInstance || running.managedInstance.instanceId !== plan.instanceId) {
        errorMessage = "managed instance registration disappeared during adoption"
        notifyState("failed")
        return
      }
      managedRecord = running.managedInstance
    } else {
      // Dev-only adoption of a gateway we did not spawn and did not register
      // (usually the global `mafw daemon`). Never stop it on quit.
      managedRecord = null
      const versionDiffers = !!expected
        && !!running.health.gatewayVersion
        && running.health.gatewayVersion !== expected.gatewayVersion
      writeLog(
        "utility",
        versionDiffers ? "mafw dev attached to a gateway with a different version" : "mafw dev attached to running gateway",
        {
          instanceId: running.health.instanceId ?? null,
          distribution: running.health.distribution ?? null,
          actual: running.health.gatewayVersion ?? null,
          expected: expected?.gatewayVersion ?? null,
        },
        versionDiffers ? "warn" : "info",
      )
    }
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
    await stopRegisteredReplacement({
      registered: running.managedInstance,
      adopt: (record) => {
        managedRecord = record
      },
      terminate: async () => {
        await terminateManagedInstance()
      },
    })
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
    const entry = preparedManagedEntry ?? plan.entry
    writeLog("utility", "mafw starting verified managed gateway", { entry }, "info")
    const { record } = await spawnManagedGateway(entry, expected)
    pollUntilReady(GATEWAY_URL, "managed", record.instanceId, handleManagedStartFailure)
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
  const quarantine = managedRoot ? readQuarantine(managedRoot) : null
  const attachment = resolveGatewayAttachment({
    ready: state === "ready",
    spawnedByUs,
    distribution: actualHealth?.distribution ?? null,
  })
  return {
    state,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    error: errorMessage ?? (state === "failed" ? "Gateway failed to start" : null),
    spawnedByUs,
    attached: attachment.attached,
    attachedOrigin: attachment.attachedOrigin,
    source: sourcePreference,
    expectedVersion: expected?.gatewayVersion ?? null,
    actualVersion: actualHealth?.gatewayVersion ?? null,
    instanceId: actualHealth?.instanceId ?? managedRecord?.instanceId ?? null,
    schemaEpoch: actualHealth?.schemaEpoch ?? expected?.schemaEpoch ?? null,
    distribution: actualHealth?.distribution ?? null,
    quarantine,
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
  sourcePreference = safeReadGatewaySourcePreference(preferenceStore(), (err) => writeLog("utility", "gateway preference unreadable; falling back to managed", { error: String(err) }, "warn"))
  return sourcePreference
}

export function setGatewaySourcePreference(value: GatewaySourcePreference): GatewaySourcePreference {
  clearSessionSourcePreference()
  writeGatewaySourcePreference(preferenceStore(), value)
  sourcePreference = value
  return value
}

export function useLegacyExternalOnce(): void {
  useLegacyExternalSession()
  sourcePreference = "external"
}

export function retryManagedGateway(force = false): Promise<void> {
  forceManagedRetryOnce = force
  return restartGateway()
}

export function resetGatewaySourcePreferenceForTests(): void {
  // Reserved for future injected tests; production never calls it.
}
