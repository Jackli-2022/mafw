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

module.exports = { NPM_PACKAGE, NPM_BIN, readPkgVersion, compareVersions, decide }
