const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const NPM_PACKAGE = "@jack200714/mafw"
const NPM_TIMEOUT_MS = 300000
const IS_WIN = process.platform === "win32"
const NPM_BIN = IS_WIN ? "npm.cmd" : "npm"

function readPkgVersion(fsMod, pkgPath) {
  try {
    // Strip the PowerShell UTF8 BOM trap (same lesson as self-update.ts token reads).
    const raw = fsMod.readFileSync(pkgPath, "utf-8").replace(/^\uFEFF/, "")
    const pkg = JSON.parse(raw)
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function decide(bundled, global) {
  if (!bundled || !global) return "skip"
  return compareVersions(global, bundled) < 0 ? "update" : "skip"
}

function readPidFile(fsMod, pidPath) {
  try {
    const raw = fsMod.readFileSync(pidPath, "utf-8").trim()
    return /^\d+$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

function pidImageName(exec, pid) {
  try {
    const out = exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 10000)
    const first = String(out).split(/\r?\n/).find((line) => line.trim().startsWith('"'))
    if (!first) return null
    return first.split('","')[0].replace(/^"/, "").toLowerCase() || null
  } catch {
    return null
  }
}

function shouldKill(imageName) {
  return imageName === "node.exe"
}

function stopGatewayDaemon(deps) {
  const pid = readPidFile(deps.fs, deps.pidFilePath)
  if (!pid) return "not-running"
  const image = deps.pidImageName(pid)
  if (!shouldKill(image)) return "not-running"
  try {
    deps.exec("taskkill", ["/F", "/T", "/PID", pid], 15000)
  } catch {
    return "not-running"
  }
  deps.sleep(1000)
  return "stopped"
}

function runUpdate(deps) {
  const log = deps.log
  const bundled = readPkgVersion(deps.fs, deps.bundledPkgPath)
  if (!bundled) {
    log("skip: bundled gateway version unreadable")
    return 0
  }

  let prefix
  try {
    prefix = String(deps.exec(NPM_BIN, ["config", "get", "prefix"], 15000)).trim()
  } catch (err) {
    log(`skip: npm not usable (${String(err.message).split("\n")[0]})`)
    return 0
  }
  if (!prefix) {
    log("skip: npm prefix empty")
    return 0
  }

  const globalPkgPath = path.join(prefix, "node_modules", ...NPM_PACKAGE.split("/"), "package.json")
  const global = readPkgVersion(deps.fs, globalPkgPath)
  if (!global) {
    log(`skip: ${NPM_PACKAGE} not installed globally — desktop will use bundled gateway`)
    return 0
  }

  if (decide(bundled, global) === "skip") {
    log(`skip: global ${global} >= bundled ${bundled}`)
    return 0
  }

  log(`gateway update: global ${global} < bundled ${bundled}`)
  log(`daemon: ${stopGatewayDaemon(deps)}`)

  try {
    deps.exec(NPM_BIN, ["install", "-g", `${NPM_PACKAGE}@${bundled}`], NPM_TIMEOUT_MS)
    log(`ok: ${NPM_PACKAGE}@${bundled} installed globally; daemon stays stopped until next desktop launch`)
  } catch (err) {
    log(`fail: npm install -g failed (${String(err.message).split("\n")[0]})`)
    log(`manual fix: npm install -g ${NPM_PACKAGE}@${bundled}`)
  }
  return 0
}

function defaultDeps() {
  const run = (cmd, args, timeoutMs) => {
    const opts = {
      timeout: timeoutMs,
      encoding: "utf-8",
      windowsHide: true,
      cwd: os.homedir(),
    }
    if (cmd.endsWith(".cmd") || cmd.endsWith(".bat")) opts.shell = true
    return execFileSync(cmd, args, opts)
  }
  return {
    fs,
    bundledPkgPath: path.join(__dirname, "..", "gateway", "package.json"),
    pidFilePath: path.join(os.homedir(), ".config", "mafw", "gateway.pid"),
    exec: run,
    pidImageName: (pid) => pidImageName(run, pid),
    sleep: (ms) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    },
    log: (line) => console.log(`[gateway-update] ${line}`),
  }
}

if (require.main === module) {
  try {
    process.exit(runUpdate(defaultDeps()))
  } catch (err) {
    console.log(`[gateway-update] fail: unexpected (${err.message})`)
    process.exit(0)
  }
}

module.exports = {
  NPM_PACKAGE,
  NPM_BIN,
  readPkgVersion,
  compareVersions,
  decide,
  readPidFile,
  pidImageName,
  shouldKill,
  stopGatewayDaemon,
  runUpdate,
}
