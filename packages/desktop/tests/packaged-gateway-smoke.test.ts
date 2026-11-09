import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertSmokeHealth,
  findFreePort,
  parseSmokeArgs,
  resolvePackagedGatewayPaths,
} from "../scripts/packaged-gateway-smoke.mjs"

function fakeAppRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mafw-smoke-path-"))
  mkdirSync(join(root, "resources", "gateway", "dist"), { recursive: true })
  writeFileSync(join(root, process.platform === "win32" ? "MAFW.exe" : "ai.mafw.desktop"), "")
  writeFileSync(join(root, "resources", "gateway", "dist", "index.js"), "")
  writeFileSync(join(root, "resources", "gateway", "dist", "release.json"), "{}")
  return root
}

test("resolves the packaged executable, resources and gateway entry", () => {
  const root = fakeAppRoot()
  try {
    const paths = resolvePackagedGatewayPaths({ appRoot: root })
    assert.equal(paths.resourcesRoot, join(root, "resources", "gateway"))
    assert.equal(paths.entry, join(root, "resources", "gateway", "dist", "index.js"))
    assert.equal(paths.releaseFile, join(root, "resources", "gateway", "dist", "release.json"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("health assertions require the managed release identity", () => {
  assert.doesNotThrow(() => assertSmokeHealth({
    status: "ok",
    gatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    schemaEpoch: 1,
    instanceId: "smoke-1",
    distribution: "desktop-managed",
  }, { gatewayVersion: "5.2.0", experienceVersion: "2026.11.1", schemaEpoch: 1 }))

  assert.throws(() => assertSmokeHealth({ status: "ok" }), /gatewayVersion/)
  assert.throws(() => assertSmokeHealth({
    status: "ok",
    gatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    schemaEpoch: 1,
  }), /instanceId/)
  assert.throws(() => assertSmokeHealth({
    status: "ok",
    gatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    schemaEpoch: 1,
    instanceId: "smoke-1",
    distribution: "standalone",
  }), /desktop-managed/)
})

test("argument parsing supports packaged and payload-only smoke modes", () => {
  assert.deepEqual(parseSmokeArgs([
    "--app-root", "dist/win-unpacked",
    "--timeout-ms", "90000",
  ], "win32"), {
    appRoot: "dist/win-unpacked",
    appExecutable: null,
    resourcesRoot: null,
    payloadOnly: false,
    timeoutMs: 90000,
  })
  assert.equal(parseSmokeArgs(["--payload-only"], "linux").payloadOnly, true)
})

test("smoke script never shells out to npm or the mafw CLI", () => {
  const source = readFileSync(new URL("../scripts/packaged-gateway-smoke.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /execFile\(["']npm/)
  assert.doesNotMatch(source, /execFile\(["']mafw/)
  assert.match(source, /ELECTRON_RUN_AS_NODE/)
})

test("finds an available loopback port", async () => {
  const port = await findFreePort()
  assert.equal(Number.isInteger(port), true)
  assert.ok(port > 0 && port < 65536)
})
