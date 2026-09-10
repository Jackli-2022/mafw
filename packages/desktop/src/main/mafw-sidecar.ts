import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import { MafwClient } from "@mafw/sdk"
import { write as writeLog } from "./logging"
import { planGatewayStart } from "./mafw-gateway-plan"

export type GatewayState = "stopped" | "starting" | "ready" | "failed"

export type GatewayStatus = {
  state: GatewayState
  port: number | null
  url: string | null
  error: string | null
  spawnedByUs?: boolean
}

type Listener = (state: GatewayState) => void

type EventPayload = {
  event: string
  data: unknown
}

type EventListener = (event: EventPayload) => void

const stateListeners = new Set<Listener>()
const eventListeners = new Set<EventListener>()

let state: GatewayState = "stopped"
let port: number | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null
let spawnedByUs = false
let bundledChild: ChildProcess | null = null
let quitHookInstalled = false

function notifyState(s: GatewayState) {
  writeLog("utility", `mafw gateway state -> ${s}`, { port, previousState: state }, "info")
  state = s
  for (const cb of stateListeners) cb(s)
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

const CANDIDATE_PORTS = [3000]

async function tryConnect(port: number): Promise<string | null> {
  const url = `http://127.0.0.1:${port}`
  const ok = await checkHealth(url)
  if (ok) writeLog("utility", "mafw gateway probe found", { url }, "info")
  return ok ? url : null
}

async function probeExistingGateway(): Promise<string | null> {
  const seen = new Set<number>()
  if (process.env.MAFW_SERVER_API_PORT) seen.add(Number(process.env.MAFW_SERVER_API_PORT))
  if (process.env.MAFW_GATEWAY_PORT) seen.add(Number(process.env.MAFW_GATEWAY_PORT))
  for (const p of CANDIDATE_PORTS) seen.add(p)
  writeLog("utility", "mafw gateway probing ports", { ports: [...seen] }, "info")
  for (const p of seen) {
    const url = await tryConnect(p)
    if (url) return url
  }
  return null
}

/** Packaged apps ship the gateway under resources/gateway (see stage-gateway.ts). */
function resolveBundledEntry(): string | null {
  if (!app.isPackaged) return null
  const entry = join(process.resourcesPath, "gateway", "dist", "index.js")
  return existsSync(entry) ? entry : null
}

function installQuitHook() {
  if (quitHookInstalled) return
  quitHookInstalled = true
  app.on("will-quit", () => {
    // Only the bundled child is desktop-owned; CLI daemons and adopted
    // gateways outlive the desktop by design.
    killBundledChild()
  })
}

function killBundledChild() {
  const child = bundledChild
  bundledChild = null
  if (!child || child.killed) return
  try {
    if (process.platform === "win32" && child.pid) {
      // cmd-less tree kill: SIGKILL is a no-op on Windows.
      execFile("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true }, () => {})
    } else {
      child.kill("SIGTERM")
    }
  } catch {}
}

function spawnBundledGateway(entry: string): void {
  installQuitHook()
  // ELECTRON_RUN_AS_NODE turns the app binary into plain Node.js; the staged
  // bundle's native modules are rebuilt for this runtime by stage-gateway.ts.
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  bundledChild = child
  child.stdout?.on("data", (chunk) => writeLog("utility", `[gateway] ${String(chunk).trimEnd()}`, undefined, "info"))
  child.stderr?.on("data", (chunk) => writeLog("utility", `[gateway] ${String(chunk).trimEnd()}`, undefined, "warn"))
  child.on("error", (err) => {
    writeLog("utility", "bundled gateway spawn error", { error: err.message }, "error")
    bundledChild = null
    notifyState("failed")
  })
  child.on("exit", (code) => {
    writeLog("utility", "bundled gateway exited", { code }, code === 0 ? "info" : "warn")
    bundledChild = null
    if (state === "starting") notifyState("failed")
  })
}

function spawnCliDaemon(): boolean {
  try {
    writeLog("utility", "mafw starting gateway via CLI", { port }, "info")
    execFile("mafw", ["daemon"], { shell: true, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        writeLog("utility", "mafw CLI daemon failed", { error: err.message, stderr: stderr?.trim() }, "error")
        notifyState("failed")
        return
      }
      writeLog("utility", "mafw CLI daemon output", { stdout: stdout?.trim() }, "info")
    })
    return true
  } catch (err: any) {
    writeLog("utility", "mafw CLI exec failed", { error: err.message }, "error")
    notifyState("failed")
    return false
  }
}

function pollUntilReady(url: string): void {
  let attempts = 0
  const maxAttempts = 30

  healthInterval = setInterval(async () => {
    attempts++
    const ok = await checkHealth(url)
    if (ok) {
      if (healthInterval) clearInterval(healthInterval)
      healthInterval = null
      notifyState("ready")
      return
    }
    if (attempts >= maxAttempts) {
      if (healthInterval) clearInterval(healthInterval)
      healthInterval = null
      notifyState("failed")
    }
  }, 1000)
}

export async function startGateway(): Promise<void> {
  if (state !== "stopped") return

  // Try connecting to an already-running gateway before spawning a new one
  const existingUrl = await probeExistingGateway()
  // cliAvailable is optimistic: a missing CLI surfaces as an execFile error,
  // which drives the same "failed" state as the plan's explicit branch.
  const plan = planGatewayStart({
    adoptUrl: existingUrl,
    bundledEntry: resolveBundledEntry(),
    cliAvailable: true,
  })
  writeLog("utility", "mafw gateway start plan", { mode: plan.mode }, "info")

  if (plan.mode === "adopt") {
    port = Number(new URL(plan.url).port)
    spawnedByUs = false
    writeLog("utility", "mafw gateway found running", { url: plan.url }, "info")
    notifyState("ready")
    return
  }

  if (plan.mode === "failed") {
    writeLog("utility", "mafw gateway start failed", { reason: plan.reason }, "error")
    notifyState("failed")
    return
  }

  notifyState("starting")
  port = 3000
  spawnedByUs = true

  if (plan.mode === "bundle") {
    writeLog("utility", "mafw starting bundled gateway", { entry: plan.entry }, "info")
    spawnBundledGateway(plan.entry)
  } else if (!spawnCliDaemon()) {
    return
  }

  pollUntilReady(`http://127.0.0.1:${port}`)
}

export function stopGateway(): void {
  if (bundledChild) {
    killBundledChild()
  } else if (spawnedByUs) {
    // CLI daemon we started; adopted gateways (spawnedByUs=false) are left alone.
    try {
      execFile("mafw", ["stop"], { shell: true, windowsHide: true })
    } catch {}
  }
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
  port = null
  spawnedByUs = false
  notifyState("stopped")
}

export function getGatewayStatus(): GatewayStatus {
  return {
    state,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    error: state === "failed" ? "Gateway failed to start" : null,
    spawnedByUs,
  }
}

export function onGatewayStateChange(cb: Listener): () => void {
  stateListeners.add(cb)
  return () => stateListeners.delete(cb)
}

export function getGatewayPort(): number | null {
  return port
}
