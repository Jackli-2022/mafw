import { fork as childFork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { MafwClient } from "@mafw/sdk"
import { BrowserWindow, utilityProcess } from "electron"
import { resolveGatewayEntry } from "./mafw-gateway-resolver"
import { write as writeLog } from "./logging"

export type GatewayState = "stopped" | "starting" | "ready" | "failed"

export type GatewayStatus = {
  state: GatewayState
  port: number | null
  url: string | null
  error: string | null
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
let gatewayProcess: ReturnType<typeof utilityProcess.fork> | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null

function notifyState(s: GatewayState) {
  state = s
  for (const cb of stateListeners) cb(s)
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (typeof addr !== "object" || !addr) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const p = addr.port
      server.close(() => resolve(p))
    })
  })
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
  return ok ? url : null
}

async function probeExistingGateway(): Promise<string | null> {
  const seen = new Set<number>()
  if (process.env.MAFW_SERVER_API_PORT) seen.add(Number(process.env.MAFW_SERVER_API_PORT))
  if (process.env.MAFW_GATEWAY_PORT) seen.add(Number(process.env.MAFW_GATEWAY_PORT))
  for (const p of CANDIDATE_PORTS) seen.add(p)
  for (const p of seen) {
    const url = await tryConnect(p)
    if (url) return url
  }
  return null
}

export async function startGateway(opts?: { opencodeServerUrl?: string; opencodeServerPassword?: string }): Promise<void> {
  if (state !== "stopped") return

  // Try connecting to an already-running gateway before spawning a new one
  const existingUrl = await probeExistingGateway()
  if (existingUrl) {
    port = Number(new URL(existingUrl).port)
    writeLog("utility", "mafw gateway found running", { url: existingUrl }, "info")
    notifyState("ready")
    return
  }

  const entry = resolveGatewayEntry()
  if (!entry) {
    writeLog("utility", "mafw gateway entry not found", {}, "error")
    notifyState("failed")
    return
  }
  writeLog("utility", "mafw gateway entry resolved", { entry }, "info")

  notifyState("starting")
  port = await findFreePort()

  try {
    const env: Record<string, string | undefined> = { ...process.env, MAFW_SERVER_API_PORT: String(port) }
    if (opts?.opencodeServerUrl) env.MAFW_SERVER_SERVE_URL = opts.opencodeServerUrl
    if (opts?.opencodeServerPassword) env.MAFW_OPENCODE_PASSWORD = opts.opencodeServerPassword
    gatewayProcess = utilityProcess.fork(entry, [], {
      env,
      stdio: "pipe",
    })

    const logStd = (stream: string, data: Buffer) => {
      writeLog("utility", `mafw gateway ${stream}`, { text: data.toString().trim() }, "info")
    }
    gatewayProcess.stdout?.on("data", (d: Buffer) => logStd("stdout", d))
    gatewayProcess.stderr?.on("data", (d: Buffer) => logStd("stderr", d))

    gatewayProcess.on("exit", (code) => {
      writeLog("utility", "mafw gateway exited", { code }, "warn")
      gatewayProcess = null
      notifyState("failed")
    })
    gatewayProcess.on("spawn", () => {
      writeLog("utility", "mafw gateway spawned", { entry, port }, "info")
    })
  } catch {
    gatewayProcess = null
    notifyState("failed")
    return
  }

  const url = `http://127.0.0.1:${port}`
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

export function stopGateway(): void {
  if (gatewayProcess) {
    try {
      gatewayProcess.kill()
    } catch {}
    gatewayProcess = null
  }
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
  port = null
  notifyState("stopped")
}

export function getGatewayStatus(): GatewayStatus {
  return {
    state,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    error: state === "failed" ? "Gateway failed to start" : null,
  }
}

export function onGatewayStateChange(cb: Listener): () => void {
  stateListeners.add(cb)
  return () => stateListeners.delete(cb)
}

export function getGatewayPort(): number | null {
  return port
}
