import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import {
  createGatewayPayloadManifest,
  type GatewayPayloadManifest,
  type GatewayReleaseManifest,
} from "./gateway-release-manifest"
import {
  moveCurrentToPrevious,
  readCurrentPointer,
  readQuarantine,
  writeCurrentPointer,
  writeQuarantine,
} from "./gateway-managed-store"
import {
  prepareManagedGateway,
  recordManagedStartFailure,
} from "./gateway-managed-lifecycle"

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")

function walkFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else out.push(relative(root, full).replaceAll("\\", "/"))
    }
  }
  visit(root)
  return out
}

function manifestDeps(root: string) {
  return {
    walk: async () => walkFiles(root),
    read: async (rel: string) => readFileSync(join(root, rel)),
    stat: async (rel: string) => ({ size: readFileSync(join(root, rel)).length }),
    sha256,
  }
}

async function fixture(version = "5.2.0") {
  const root = mkdtempSync(join(tmpdir(), "mafw-lifecycle-"))
  const resources = join(root, "resources")
  const managed = join(root, "managed")
  mkdirSync(join(resources, "dist"), { recursive: true })
  writeFileSync(join(resources, "dist", "index.js"), "console.log('managed')\n")
  mkdirSync(join(resources, "node_modules", "better-sqlite3", "build", "Release"), { recursive: true })
  writeFileSync(
    join(resources, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    "native",
  )
  const { manifest, digest } = await createGatewayPayloadManifest(resources, manifestDeps(resources))
  const release: GatewayReleaseManifest = {
    schemaVersion: 1,
    productVersion: version,
    gatewayVersion: version,
    desktopMinimumGatewayVersion: version,
    experienceVersion: "2026.11.1",
    minimumClientExperienceVersion: "2026.11.0",
    schemaEpoch: 1,
    payloadManifestSha256: digest,
  }
  writeFileSync(join(resources, "payload-manifest.json"), JSON.stringify(manifest))
  writeFileSync(join(resources, "release-manifest.json"), JSON.stringify(release))
  return {
    root,
    resources,
    managed,
    payload: manifest,
    release,
    expected: {
      gatewayVersion: version,
      experienceVersion: "2026.11.1",
      minimumClientExperienceVersion: "2026.11.0",
      schemaEpoch: 1,
      channel: "prod",
    },
  }
}

function pointer(version: string, hash: string, dir: string) {
  return {
    version,
    payloadManifestSha256: hash,
    versionDir: dir,
    installedAt: "2026-11-09T00:00:00.000Z",
  }
}

describe("managed gateway lifecycle", () => {
  test("installs and points at a valid resource payload when no current exists", async () => {
    const f = await fixture()
    try {
      const result = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(result.kind).toBe("start")
      if (result.kind === "start") {
        expect(result.entry).toContain("5.2.0-")
        expect(result.versionDir).toContain("5.2.0-")
      }
      expect(readCurrentPointer(f.managed)?.payloadManifestSha256).toBe(f.release.payloadManifestSha256)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("reuses a complete current payload without reinstalling", async () => {
    const f = await fixture()
    try {
      const first = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      writeFileSync(join(f.resources, "dist", "index.js"), "tampered source")
      const second = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(first.kind).toBe("start")
      expect(second.kind).toBe("start")
      if (first.kind === "start" && second.kind === "start") {
        expect(second.versionDir).toBe(first.versionDir)
        expect(readFileSync(join(second.versionDir, "dist", "index.js"), "utf8")).toBe("console.log('managed')\n")
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("quarantine blocks the same payload until force retry", async () => {
    const f = await fixture()
    try {
      await writeQuarantine(f.managed, {
        version: f.release.gatewayVersion,
        payloadManifestSha256: f.release.payloadManifestSha256,
        error: "native module failed",
        failedAt: "2026-11-09T00:00:00.000Z",
      })
      const blocked = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(blocked.kind).toBe("quarantined")
      expect(readCurrentPointer(f.managed)).toBeNull()

      const retried = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: true,
        deps: {},
      })
      expect(retried.kind).toBe("start")
      expect(readQuarantine(f.managed)).toBeNull()
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("a quarantined resource falls back to a still-valid current payload", async () => {
    const f = await fixture("5.1.0")
    try {
      const old = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(old.kind).toBe("start")

      writeFileSync(join(f.resources, "dist", "index.js"), "console.log('new')\n")
      const { manifest, digest } = await createGatewayPayloadManifest(f.resources, manifestDeps(f.resources))
      const newRelease: GatewayReleaseManifest = {
        ...f.release,
        productVersion: "5.2.0",
        gatewayVersion: "5.2.0",
        desktopMinimumGatewayVersion: "5.2.0",
        payloadManifestSha256: digest,
      }
      writeFileSync(join(f.resources, "payload-manifest.json"), JSON.stringify(manifest))
      writeFileSync(join(f.resources, "release-manifest.json"), JSON.stringify(newRelease))
      await writeQuarantine(f.managed, {
        version: newRelease.gatewayVersion,
        payloadManifestSha256: newRelease.payloadManifestSha256,
        error: "new payload failed",
        failedAt: "2026-11-09T00:00:00.000Z",
      })

      const fallback = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: { ...f.expected, gatewayVersion: "5.2.0" },
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(fallback.kind).toBe("start")
      if (old.kind === "start" && fallback.kind === "start") {
        expect(fallback.versionDir).toBe(old.versionDir)
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("a new payload digest proceeds without manual retry", async () => {
    const f = await fixture()
    try {
      await writeQuarantine(f.managed, {
        version: f.release.gatewayVersion,
        payloadManifestSha256: "b".repeat(64),
        error: "older payload failed",
        failedAt: "2026-11-09T00:00:00.000Z",
      })
      const result = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(result.kind).toBe("start")
      expect(readQuarantine(f.managed)).toBeNull()
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("install failure leaves the current pointer unchanged", async () => {
    const f = await fixture()
    try {
      const current = pointer("5.1.0", "b".repeat(64), "5.1.0-bbbbbbbbbbbb")
      await writeCurrentPointer(f.managed, current)
      writeFileSync(join(f.resources, "dist", "index.js"), "corrupt")
      const result = await prepareManagedGateway({
        resourcesRoot: f.resources,
        managedRoot: f.managed,
        expected: f.expected,
        canReplaceRunning: true,
        forceRetry: false,
        deps: {},
      })
      expect(result.kind).toBe("failed")
      expect(readCurrentPointer(f.managed)).toEqual(current)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("same-schema failure returns the previous pointer for restart", async () => {
    const f = await fixture()
    try {
      const previous = pointer("5.1.0", "b".repeat(64), "5.1.0-bbbbbbbbbbbb")
      const current = pointer(
        f.release.gatewayVersion,
        f.release.payloadManifestSha256,
        "5.2.0-aaaaaaaaaaaa",
      )
      await writeCurrentPointer(f.managed, previous)
      await moveCurrentToPrevious(f.managed)
      await writeCurrentPointer(f.managed, current)
      const failure = await recordManagedStartFailure({
        managedRoot: f.managed,
        release: f.release,
        error: "startup timeout",
        previousAvailable: true,
        schemaChanged: false,
        deps: {},
      })
      expect(failure.blocked).toBe(false)
      expect(failure.restartPointer).toEqual(previous)
      expect(readCurrentPointer(f.managed)).toEqual(previous)
      expect(readQuarantine(f.managed)?.payloadManifestSha256).toBe(f.release.payloadManifestSha256)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("schema-change failure blocks without rolling back", async () => {
    const f = await fixture()
    try {
      const current = pointer(
        f.release.gatewayVersion,
        f.release.payloadManifestSha256,
        "5.2.0-aaaaaaaaaaaa",
      )
      await writeCurrentPointer(f.managed, current)
      const failure = await recordManagedStartFailure({
        managedRoot: f.managed,
        release: f.release,
        error: "new schema failed to start",
        previousAvailable: true,
        schemaChanged: true,
        deps: {},
      })
      expect(failure).toEqual({ restartPointer: null, blocked: true })
      expect(readCurrentPointer(f.managed)).toEqual(current)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })
})
