const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const NPM_PACKAGE = "@jack200714/mafw"
const NPM_TIMEOUT_MS = 120000
const IS_WIN = process.platform === "win32"
const NPM_BIN = IS_WIN ? "npm.cmd" : "npm"

function readPkgVersion(fsMod, pkgPath) {
  try {
    const pkg = JSON.parse(fsMod.readFileSync(pkgPath, "utf-8"))
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
}
