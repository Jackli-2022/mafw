import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import {
  createGatewayPayloadManifest,
  parseGatewayPayloadManifest,
  parseGatewayReleaseManifest,
  verifyGatewayPayload,
} from "./gateway-release-manifest"

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

function deps(root: string) {
  return {
    walk: async () => walkFiles(root),
    read: async (rel: string) => readFileSync(join(root, rel)),
    stat: async (rel: string) => ({ size: statSync(join(root, rel)).size }),
    sha256,
  }
}

const release = {
  schemaVersion: 1 as const,
  productVersion: "5.2.0",
  gatewayVersion: "5.2.0",
  desktopMinimumGatewayVersion: "5.2.0",
  experienceVersion: "2026.11.1",
  minimumClientExperienceVersion: "2026.11.0",
  schemaEpoch: 1,
  payloadManifestSha256: "a".repeat(64),
}

describe("gateway release manifests", () => {
  test("release manifest round-trips and rejects missing or invalid fields", () => {
    expect(parseGatewayReleaseManifest(release)).toEqual(release)
    expect(() => parseGatewayReleaseManifest({ ...release, schemaVersion: 2 })).toThrow()
    expect(() => parseGatewayReleaseManifest({ ...release, schemaEpoch: 0 })).toThrow()
    expect(() => parseGatewayReleaseManifest({ ...release, payloadManifestSha256: "abc" })).toThrow()
  })

  test("payload manifest validates paths, sizes and hashes", () => {
    const payload = {
      schemaVersion: 1 as const,
      files: [{ path: "dist/index.js", size: 3, sha256: "b".repeat(64) }],
    }
    expect(parseGatewayPayloadManifest(payload)).toEqual(payload)
    expect(() => parseGatewayPayloadManifest({ ...payload, files: [{ ...payload.files[0], path: "../escape" }] })).toThrow()
    expect(() => parseGatewayPayloadManifest({ ...payload, files: [{ ...payload.files[0], size: -1 }] })).toThrow()
  })

  test("creates a sorted manifest, excludes control files, and changes digest with content", async () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-payload-manifest-"))
    try {
      mkdirSync(join(root, "dist"), { recursive: true })
      writeFileSync(join(root, "dist", "z.js"), "z")
      writeFileSync(join(root, "dist", "a.js"), "a")
      writeFileSync(join(root, "release-manifest.json"), "{}")
      writeFileSync(join(root, "payload-manifest.json"), "{}")
      writeFileSync(join(root, ".install-complete.json"), "{}")

      const first = await createGatewayPayloadManifest(root, deps(root))
      expect(first.manifest.files.map((file) => file.path)).toEqual(["dist/a.js", "dist/z.js"])
      expect(first.manifest.files[0].sha256).toHaveLength(64)
      expect(first.digest).toHaveLength(64)
      await verifyGatewayPayload(root, first.manifest, deps(root))

      writeFileSync(join(root, "dist", "a.js"), "changed")
      const second = await createGatewayPayloadManifest(root, deps(root))
      expect(second.digest).not.toBe(first.digest)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
