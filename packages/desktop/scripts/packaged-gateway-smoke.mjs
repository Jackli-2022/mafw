import { execFile } from "node:child_process"
import { createConnection } from "node:net"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(desktopDir, "../..")

export function parseSmokeArgs(args, platform = process.platform) {
  void platform
  const parsed = {
    appRoot: null,
    appExecutable: null,
    resourcesRoot: null,
    payloadOnly: false,
    timeoutMs: 120_000,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--payload-only") parsed.payloadOnly = true
    else if (arg === "--app-root") parsed.appRoot = args[++index] ?? null
    else if (arg === "--app-executable") parsed.appExecutable = args[++index] ?? null
    else if (arg === "--resources-root") parsed.resourcesRoot = args[++index] ?? null
    else if (arg === "--timeout-ms") parsed.timeoutMs = Number(args[++index] ?? parsed.timeoutMs)
    else throw new Error(`unknown smoke argument: ${arg}`)
  }
  return parsed
}

function executableCandidates(appRoot, platform) {
  if (platform === "darwin") {
    return [
      path.join(appRoot, "Contents", "MacOS", "MAFW"),
      path.join(appRoot, "Contents", "MacOS", "MAFW Beta"),
      path.join(appRoot, "Contents", "MacOS", "MAFW Dev"),
    ]
  }
  if (platform === "win32") {
    return ["MAFW.exe", "MAFW Beta.exe", "MAFW Dev.exe"].map((name) => path.join(appRoot, name))
  }
  return ["ai.mafw.desktop", "mafw", "MAFW"].map((name) => path.join(appRoot, name))
}

function findExecutable(appRoot, platform) {
  for (const candidate of executableCandidates(appRoot, platform)) {
    if (existsSync(candidate)) return candidate
  }
  try {
    const names = readdirSync(appRoot)
      .filter((name) => platform === "win32"
        ? name.toLowerCase().endsWith(".exe") && !name.toLowerCase().includes("uninstall")
        : !name.includes("."))
    if (names.length > 0) return path.join(appRoot, names[0])
  } catch {
    // The caller gets the explicit error below.
  }
  throw new Error(`packaged executable not found under ${appRoot}`)
}

export function resolvePackagedGatewayPaths(input) {
  const platform = input.platform ?? process.platform
  const appRoot = input.appRoot ? path.resolve(input.appRoot) : null
  const executable = input.appExecutable
    ? path.resolve(input.appExecutable)
    : appRoot
      ? findExecutable(appRoot, platform)
      : null
  if (!executable || !existsSync(executable)) {
    throw new Error("packaged executable missing; pass --app-root or --app-executable")
  }
  const root = input.resourcesRoot
    ? path.resolve(input.resourcesRoot)
    : appRoot && platform === "darwin" && appRoot.endsWith(".app")
      ? path.join(appRoot, "Contents", "Resources", "gateway")
      : path.join(appRoot ?? path.dirname(executable), "resources", "gateway")
  const entry = path.join(root, "dist", "index.js")
  const releaseFile = path.join(root, "dist", "release.json")
  if (!existsSync(entry)) throw new Error(`packaged gateway entry not found: ${entry}`)
  if (!existsSync(releaseFile)) throw new Error(`packaged gateway release metadata not found: ${releaseFile}`)
  return { executable, resourcesRoot: root, entry, releaseFile }
}

export function assertSmokeHealth(health, expected = {}) {
  if (health?.status !== "ok") throw new Error(`health status is not ok: ${health?.status ?? "missing"}`)
  if (typeof health.gatewayVersion !== "string" || !health.gatewayVersion) {
    throw new Error("health is missing gatewayVersion")
  }
  if (typeof health.experienceVersion !== "string" || !health.experienceVersion) {
    throw new Error("health is missing experienceVersion")
  }
  if (typeof health.schemaEpoch !== "number" || health.schemaEpoch <= 0) {
    throw new Error("health is missing schemaEpoch")
  }
  if (typeof health.instanceId !== "string" || !health.instanceId) {
    throw new Error("health is missing instanceId")
  }
  if (health.distribution !== "desktop-managed") {
    throw new Error(`health distribution is not desktop-managed: ${health.distribution ?? "missing"}`)
  }
  for (const key of ["gatewayVersion", "experienceVersion", "schemaEpoch"]) {
    if (expected[key] !== undefined && health[key] !== expected[key]) {
      throw new Error(`health ${key}=${health[key]} does not match release ${expected[key]}`)
    }
  }
}

export function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => port ? resolve(port) : reject(new Error("failed to allocate a free port")))
    })
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function portReachable(port, host = "127.0.0.1", timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false
    const done = (value) => {
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

async function waitForHealth(port, timeoutMs, child, output) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited before health (code=${child.exitCode})\n${output()}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      })
      if (response.ok) return await response.json()
    } catch {
      // Gateway not listening yet.
    }
    await wait(500)
  }
  throw new Error(`gateway health timed out after ${timeoutMs}ms\n${output()}`)
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true }, () => resolve())
    } else {
      try { child.kill("SIGTERM") } catch {}
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL") } catch {}
        resolve()
      }, 5000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    }
  })
}

async function assertPortClosed(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!await portReachable(port)) return
    await wait(250)
  }
  throw new Error(`gateway left port ${port} open after shutdown`)
}

async function removeTempDir(dir) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 9) throw error
      await wait(300)
    }
  }
}

function localElectron() {
  const names = process.platform === "win32" ? ["electron.exe"] : ["electron", "Electron"]
  const roots = [
    path.join(desktopDir, "node_modules", "electron", "dist"),
    path.join(repoRoot, "node_modules", "electron", "dist"),
  ]
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error("local Electron executable not found; pass --app-executable")
}

export async function runPackagedGatewaySmoke(options) {
  const paths = resolvePackagedGatewayPaths(options)
  const release = JSON.parse(readFileSync(paths.releaseFile, "utf8").replace(/^\uFEFF/, ""))
  const port = await findFreePort()
  const home = mkdtempSync(path.join(tmpdir(), "mafw-smoke-home-"))
  mkdirSync(path.join(home, "AppData", "Roaming"), { recursive: true })
  mkdirSync(path.join(home, "AppData", "Local"), { recursive: true })
  let output = ""
  const capture = (chunk) => {
    output = (output + String(chunk)).slice(-8000)
  }
  const env = { ...process.env }
  delete env.MAFW_TAKEOVER
  delete env.MAFW_GATEWAY_PORT
  delete env.MAFW_SERVER_API_PORT
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: "1",
    MAFW_DESKTOP_MANAGED: "1",
    MAFW_DESKTOP_CHANNEL: "prod",
    MAFW_DESKTOP_INSTANCE_ID: "packaged-smoke",
    MAFW_SERVER_API_PORT: String(port),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
  })

  const child = spawn(paths.executable, [paths.entry], {
    env,
    cwd: home,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdout?.on("data", capture)
  child.stderr?.on("data", capture)
  try {
    const health = await waitForHealth(port, options.timeoutMs ?? 120_000, child, () => output)
    assertSmokeHealth(health, release)
    return health
  } finally {
    await killTree(child)
    await assertPortClosed(port).catch((error) => {
      throw Object.assign(error, { cause: output })
    })
    // Windows may retain handles for a few hundred ms after the process exits.
    // Cleanup is best-effort; a stale temp dir must not mask a healthy smoke.
    await removeTempDir(home).catch((error) => {
      console.warn(`[smoke] temporary HOME cleanup failed: ${error?.message ?? error}`)
    })
  }
}

async function main() {
  const args = parseSmokeArgs(process.argv.slice(2))
  const input = {
    appRoot: args.appRoot,
    appExecutable: args.appExecutable,
    resourcesRoot: args.resourcesRoot,
    timeoutMs: args.timeoutMs,
  }
  if (args.payloadOnly) {
    input.appExecutable = input.appExecutable ?? localElectron()
    input.resourcesRoot = input.resourcesRoot ?? path.join(desktopDir, "gateway-bundle")
    if (!input.appRoot) input.appRoot = null
  }
  const health = await runPackagedGatewaySmoke(input)
  console.log(`[smoke] gateway ${health.gatewayVersion} healthy (${health.instanceId})`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`[smoke] ${error?.stack ?? error}`)
    process.exit(1)
  })
}
