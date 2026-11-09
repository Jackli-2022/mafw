import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import {
  createGatewayPayloadManifest,
  type GatewayReleaseManifest,
} from "./gateway-release-manifest"
import { gatewayPayloadId, installGatewayPayload } from "./gateway-payload-installer"
import { readCurrentPointer, writeCurrentPointer } from "./gateway-managed-store"

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

function releaseFor(digest: string): GatewayReleaseManifest {
  return {
    schemaVersion: 1,
    productVersion: "5.2.0",
    gatewayVersion: "5.2.0",
    desktopMinimumGatewayVersion: "5.2.0",
    experienceVersion: "2026.11.1",
    minimumClientExperienceVersion: "2026.11.0",
    schemaEpoch: 1,
    payloadManifestSha256: digest,
  }
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mafw-payload-install-"))
  const source = join(root, "source")
  const managed = join(root, "managed")
  mkdirSync(join(source, "dist"), { recursive: true })
  writeFileSync(join(source, "dist", "index.js"), "console.log('gateway')\n")
  mkdirSync(join(source, "node_modules", "dep"), { recursive: true })
  writeFileSync(join(source, "node_modules", "dep", "index.js"), "module.exports=1\n")
  const { manifest, digest } = await createGatewayPayloadManifest(source, manifestDeps(source))
  return {
    root,
    source,
    managed,
    versionsRoot: join(managed, "versions"),
    payload: manifest,
    release: releaseFor(digest),
  }
}

describe("installGatewayPayload", () => {
  test("uses a version-plus-digest payload id", () => {
    expect(gatewayPayloadId("5.2.0", "a".repeat(64))).toBe("5.2.0-aaaaaaaaaaaa")
  })

  test("fresh install copies files, writes manifests and the completion marker", async () => {
    const f = await fixture()
    try {
      const result = await installGatewayPayload({
        sourceRoot: f.source,
        versionsRoot: f.versionsRoot,
        release: f.release,
        payload: f.payload,
      })
      expect(result.status).toBe("installed")
      expect(existsSync(result.entry)).toBe(true)
      expect(existsSync(join(result.versionDir, "release-manifest.json"))).toBe(true)
      expect(existsSync(join(result.versionDir, "payload-manifest.json"))).toBe(true)
      expect(existsSync(join(result.versionDir, ".install-complete.json"))).toBe(true)
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("reuses a complete payload without reading changed source files", async () => {
    const f = await fixture()
    try {
      const first = await installGatewayPayload({
        sourceRoot: f.source,
        versionsRoot: f.versionsRoot,
        release: f.release,
        payload: f.payload,
      })
      writeFileSync(join(first.versionDir, "dist", "index.js"), "already installed\n")
      writeFileSync(join(f.source, "dist", "index.js"), "different source\n")
      const second = await installGatewayPayload({
        sourceRoot: f.source,
        versionsRoot: f.versionsRoot,
        release: f.release,
        payload: f.payload,
      })
      expect(second.status).toBe("reused")
      expect(readFileSync(join(second.versionDir, "dist", "index.js"), "utf8")).toBe("already installed\n")
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("corrupt input rejects without touching current and cleans staging", async () => {
    const f = await fixture()
    try {
      const current = {
        version: "5.1.0",
        payloadManifestSha256: "b".repeat(64),
        versionDir: "5.1.0-bbbbbbbbbbbb",
        installedAt: "2026-11-09T00:00:00.000Z",
      }
      await writeCurrentPointer(f.managed, current)
      writeFileSync(join(f.source, "dist", "index.js"), "tampered\n")

      await expect(installGatewayPayload({
        sourceRoot: f.source,
        versionsRoot: f.versionsRoot,
        release: f.release,
        payload: f.payload,
      })).rejects.toThrow()
      expect(readCurrentPointer(f.managed)).toEqual(current)
      expect(existsSync(join(f.versionsRoot, gatewayPayloadId("5.2.0", f.release.payloadManifestSha256)))).toBe(false)
      const staging = join(f.managed, "staging")
      expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([])
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("preserves executable bits and symlinks where the platform supports them", async () => {
    const f = await fixture()
    try {
      if (process.platform !== "win32") {
        const script = join(f.source, "node_modules", "dep", "run.sh")
        writeFileSync(script, "#!/bin/sh\nexit 0\n")
        chmodSync(script, 0o755)
        symlinkSync("index.js", join(f.source, "node_modules", "dep", "link.js"))
      }
      const { manifest, digest } = await createGatewayPayloadManifest(f.source, manifestDeps(f.source))
      const result = await installGatewayPayload({
        sourceRoot: f.source,
        versionsRoot: f.versionsRoot,
        release: releaseFor(digest),
        payload: manifest,
      })
      if (process.platform !== "win32") {
        expect(lstatSync(join(result.versionDir, "node_modules", "dep", "link.js")).isSymbolicLink()).toBe(true)
        expect((lstatSync(join(result.versionDir, "node_modules", "dep", "run.sh")).mode & 0o111) !== 0).toBe(true)
      } else {
        expect(existsSync(join(result.versionDir, "node_modules", "dep", "index.js"))).toBe(true)
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })
})
