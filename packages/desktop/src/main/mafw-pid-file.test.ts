import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearGatewayPidFile, gatewayPidFilePath, writeGatewayPidFile } from "./mafw-pid-file"

const tempRoot = mkdtempSync(join(tmpdir(), "mafw-pid-test-"))
const configDir = join(tempRoot, "cfg", "mafw")
const pidFile = join(configDir, "gateway.pid")

afterAll(() => {
  try {
    require("node:fs").rmSync(tempRoot, { recursive: true, force: true })
  } catch {}
})

describe("gateway pid file", () => {
  test("path lands in .config/mafw/gateway.pid", () => {
    expect(gatewayPidFilePath(configDir)).toBe(pidFile)
  })

  test("writes pid, creating parent dirs", async () => {
    await writeGatewayPidFile(4242, pidFile)
    expect(readFileSync(pidFile, "utf-8")).toBe("4242")
  })

  test("clears the file when it still points at our pid", async () => {
    writeFileSync(pidFile, "4242", "utf-8")
    expect(await clearGatewayPidFile(4242, pidFile)).toBe(true)
    expect(existsSync(pidFile)).toBe(false)
  })

  test("keeps the file when another process owns it (takeover)", async () => {
    writeFileSync(pidFile, "9999", "utf-8")
    expect(await clearGatewayPidFile(4242, pidFile)).toBe(false)
    expect(readFileSync(pidFile, "utf-8")).toBe("9999")
  })

  test("clear is a silent no-op on a missing file", async () => {
    expect(await clearGatewayPidFile(4242, join(configDir, "missing.pid"))).toBe(false)
  })
})

describe("writeGatewayPidFile", () => {
  test("overwrites a stale pid from a previous daemon", async () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(pidFile, "1111", "utf-8")
    await writeGatewayPidFile(5555, pidFile)
    expect(readFileSync(pidFile, "utf-8")).toBe("5555")
  })
})
