import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareVersions, decide, readPkgVersion, readPidFile, runUpdate, shouldKill, stopGatewayDaemon } from "./update-global-gateway.cjs"

describe("compareVersions", () => {
  test("orders major/minor/patch", () => {
    expect(compareVersions("4.10.1", "4.9.9")).toBeGreaterThan(0)
    expect(compareVersions("4.10.0", "4.10.1")).toBeLessThan(0)
    expect(compareVersions("4.10.1", "4.10.1")).toBe(0)
  })
  test("missing segments equal zero", () => {
    expect(compareVersions("4.10", "4.10.0")).toBe(0)
  })
  test("non-numeric suffix does not crash", () => {
    expect(compareVersions("4.10.1-beta", "4.10.1")).toBe(0)
  })
})

describe("decide", () => {
  test("update only when global < bundled (never downgrade)", () => {
    expect(decide("4.10.1", "4.9.0")).toBe("update")
    expect(decide("4.10.1", "4.10.1")).toBe("skip")
    expect(decide("4.10.1", "4.11.0")).toBe("skip")
  })
  test("missing versions skip", () => {
    expect(decide(null, "4.9.0")).toBe("skip")
    expect(decide("4.10.1", null)).toBe("skip")
    expect(decide(null, null)).toBe("skip")
  })
})

describe("readPkgVersion", () => {
  test("reads version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pkg = join(dir, "package.json")
    writeFileSync(pkg, JSON.stringify({ name: "x", version: "4.10.1" }))
    expect(readPkgVersion(require("node:fs"), pkg)).toBe("4.10.1")
  })
  test("null on missing file or bad json or empty version", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    expect(readPkgVersion(require("node:fs"), join(dir, "absent.json"))).toBeNull()
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{oops")
    expect(readPkgVersion(require("node:fs"), bad)).toBeNull()
    const empty = join(dir, "empty.json")
    writeFileSync(empty, JSON.stringify({ name: "x" }))
    expect(readPkgVersion(require("node:fs"), empty)).toBeNull()
  })
  test("tolerates UTF-8 BOM (PowerShell Set-Content trap)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pkg = join(dir, "package.json")
    writeFileSync(pkg, "\uFEFF" + JSON.stringify({ version: "4.10.1" }))
    expect(readPkgVersion(require("node:fs"), pkg)).toBe("4.10.1")
  })
})

describe("readPidFile", () => {
  test("numeric pid only", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pidPath = join(dir, "gateway.pid")
    writeFileSync(pidPath, "4242\n")
    expect(readPidFile(require("node:fs"), pidPath)).toBe("4242")
    writeFileSync(pidPath, "not-a-pid")
    expect(readPidFile(require("node:fs"), pidPath)).toBeNull()
    expect(readPidFile(require("node:fs"), join(dir, "absent.pid"))).toBeNull()
  })
})

describe("shouldKill", () => {
  test("only node.exe image", () => {
    expect(shouldKill("node.exe")).toBe(true)
    expect(shouldKill("msedge.exe")).toBe(false)
    expect(shouldKill(null)).toBe(false)
  })
})

describe("stopGatewayDaemon", () => {
  function fakeDeps(pidContent, imageName, calls) {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pidPath = join(dir, "gateway.pid")
    if (pidContent !== null) writeFileSync(pidPath, pidContent)
    return {
      deps: {
        fs: require("node:fs"),
        pidFilePath: pidPath,
        pidImageName: (pid) => {
          calls.push(["image", pid])
          return imageName
        },
        exec: (cmd, args) => {
          calls.push([cmd, args])
          return ""
        },
        sleep: (ms) => calls.push(["sleep", ms]),
      },
      pidPath,
    }
  }

  test("kills when pid alive and image is node.exe", () => {
    const calls = []
    const { deps } = fakeDeps("4242", "node.exe", calls)
    expect(stopGatewayDaemon(deps)).toBe("stopped")
    expect(calls.some(([cmd]) => cmd === "taskkill")).toBe(true)
  })

  test("skips when image is not node.exe (pid reuse guard)", () => {
    const calls = []
    const { deps } = fakeDeps("4242", "msedge.exe", calls)
    expect(stopGatewayDaemon(deps)).toBe("not-running")
    expect(calls.some(([cmd]) => cmd === "taskkill")).toBe(false)
  })

  test("skips when pid file missing or dead process", () => {
    const calls = []
    const { deps } = fakeDeps(null, null, calls)
    expect(stopGatewayDaemon(deps)).toBe("not-running")
    const calls2 = []
    const { deps: deps2 } = fakeDeps("4242", null, calls2)
    expect(stopGatewayDaemon(deps2)).toBe("not-running")
    expect(calls2.some(([cmd]) => cmd === "taskkill")).toBe(false)
  })
})

describe("runUpdate", () => {
  const realFs = require("node:fs")
  function fixture(over = {}) {
    const { installError = null, ...depsOver } = over
    const dir = mkdtempSync(join(tmpdir(), "gwupd-run-"))
    const bundledPkgPath = join(dir, "bundled", "gateway", "package.json")
    realFs.mkdirSync(join(dir, "bundled", "gateway"), { recursive: true })
    realFs.writeFileSync(bundledPkgPath, JSON.stringify({ version: "4.10.1" }))
    const pidPath = join(dir, "gateway.pid")
    const logs = []
    const deps = {
      fs: realFs,
      bundledPkgPath,
      pidFilePath: pidPath,
      exec: (cmd, args) => {
        if (cmd === "npm.cmd" && args[0] === "config") return join(dir, "fake-prefix") + "\n"
        if (installError && cmd === "npm.cmd" && args[0] === "install") throw installError
        logs.push([cmd, args])
        return ""
      },
      pidImageName: () => "node.exe",
      sleep: () => {},
      log: (line) => logs.push(line),
      ...depsOver,
    }
    return { deps, logs, dir, pidPath }
  }

  test("skips when npm unusable", () => {
    const { deps, logs } = fixture({ exec: () => { throw new Error("spawn ENOENT") } })
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("skip: npm not usable"))).toBe(true)
  })

  test("skips when global package missing", () => {
    const { deps, logs } = fixture()
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("not installed globally"))).toBe(true)
  })

  test("skips when global >= bundled (never downgrade)", () => {
    const { deps, logs, dir } = fixture()
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.10.1" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("skip: global"))).toBe(true)
    expect(logs.some(([cmd, args]) => cmd === "npm.cmd" && args?.[0] === "install")).toBe(false)
  })

  test("stops daemon then installs when global < bundled", () => {
    const { deps, logs, dir, pidPath } = fixture()
    realFs.writeFileSync(pidPath, "4242")
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.9.0" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some(([cmd, args]) => cmd === "taskkill" && args.includes("4242"))).toBe(true)
    expect(logs.some(([cmd, args]) => cmd === "npm.cmd" && args[0] === "install" && args[2] === "@jack200714/mafw@4.10.1")).toBe(true)
  })

  test("npm failure leaves manual-fix log, exit 0", () => {
    const { deps, logs, dir } = fixture({ installError: new Error("ETIMEDOUT") })
    const nm = join(dir, "fake-prefix", "node_modules", "@jack200714", "mafw")
    realFs.mkdirSync(nm, { recursive: true })
    realFs.writeFileSync(join(nm, "package.json"), JSON.stringify({ version: "4.9.0" }))
    expect(runUpdate(deps)).toBe(0)
    expect(logs.some((l) => String(l).includes("manual fix: npm install -g @jack200714/mafw@4.10.1"))).toBe(true)
  })
})
