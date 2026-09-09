import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const originalEnv = { ...process.env }

async function tempDir() {
  return await mkdtemp(join(tmpdir(), "mafw-resolver-"))
}

describe("resolveGatewayEntry", () => {
  let root: string
  let mafwDir: string
  let gatewayEntry: string

  beforeEach(async () => {
    root = await tempDir()
    mafwDir = join(root, ".mafw")
    gatewayEntry = join(mafwDir, "gateway", "dist", "gateway", "src", "index.js")
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    await rm(root, { recursive: true, force: true })
  })

  test("resolves MAFW_GATEWAY_ENTRY env var first", async () => {
    await mkdir(join(mafwDir, "gateway", "dist", "gateway", "src"), { recursive: true })
    await writeFile(gatewayEntry, "")
    process.env.MAFW_GATEWAY_ENTRY = gatewayEntry

    const result = await import("./mafw-gateway-resolver")
    expect(result.resolveGatewayEntry()).toBe(gatewayEntry)

    delete process.env.MAFW_GATEWAY_ENTRY
  })

  test("resolves dev path relative to module location", async () => {
    delete process.env.MAFW_GATEWAY_ENTRY
    const { resolveGatewayEntry } = await import("./mafw-gateway-resolver")
    const entry = resolveGatewayEntry()
    expect(entry).not.toBeNull()
    expect(entry!.endsWith("index.js")).toBe(true)
  })

  test("prefers env var over file system paths", async () => {
    const envEntry = join(root, "env-entry.js")
    await writeFile(envEntry, "")
    process.env.MAFW_GATEWAY_ENTRY = envEntry

    await mkdir(join(mafwDir, "gateway", "dist", "gateway", "src"), { recursive: true })
    await writeFile(gatewayEntry, "")

    const { resolveGatewayEntry } = await import("./mafw-gateway-resolver")
    expect(resolveGatewayEntry()).toBe(envEntry)

    delete process.env.MAFW_GATEWAY_ENTRY
  })

  test("resolves MAFW_DIR when set", async () => {
    delete process.env.MAFW_GATEWAY_ENTRY
    process.env.MAFW_DIR = root
    const entryPath = join(root, "gateway", "dist", "gateway", "src", "index.js")
    await mkdir(join(root, "gateway", "dist", "gateway", "src"), { recursive: true })
    await writeFile(entryPath, "")

    const { resolveGatewayEntry } = await import("./mafw-gateway-resolver")
    expect(resolveGatewayEntry()).toBe(entryPath)

    delete process.env.MAFW_DIR
  })

  test("resolves OPENCODE_PROJECT_ROOT when set", async () => {
    delete process.env.MAFW_GATEWAY_ENTRY
    process.env.OPENCODE_PROJECT_ROOT = root
    const entryPath = join(root, "gateway", "dist", "gateway", "src", "index.js")
    await mkdir(join(root, "gateway", "dist", "gateway", "src"), { recursive: true })
    await writeFile(entryPath, "")

    const { resolveGatewayEntry } = await import("./mafw-gateway-resolver")
    expect(resolveGatewayEntry()).toBe(entryPath)

    delete process.env.OPENCODE_PROJECT_ROOT
  })
})
