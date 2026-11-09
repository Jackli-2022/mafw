import { createHash, randomUUID } from "node:crypto"
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  parseGatewayPayloadManifest,
  parseGatewayReleaseManifest,
  verifyGatewayPayload,
  type GatewayPayloadManifest,
  type GatewayReleaseManifest,
} from "./gateway-release-manifest"

export interface InstallDeps {
  /** Test seam only; production uses the real filesystem. */
  now?(): string
  randomId?(): string
}

interface CompletionRecord {
  schemaVersion: 1
  gatewayVersion: string
  schemaEpoch: number
  payloadManifestSha256: string
  installedAt: string
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")

export function gatewayPayloadId(gatewayVersion: string, payloadManifestSha256: string): string {
  return `${gatewayVersion}-${payloadManifestSha256.slice(0, 12).toLowerCase()}`
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return null
  }
}

function completionMatches(
  value: unknown,
  release: GatewayReleaseManifest,
): CompletionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1) return null
  if (raw.gatewayVersion !== release.gatewayVersion) return null
  if (raw.schemaEpoch !== release.schemaEpoch) return null
  if (raw.payloadManifestSha256 !== release.payloadManifestSha256) return null
  return raw as unknown as CompletionRecord
}

async function payloadIsComplete(
  versionDir: string,
  release: GatewayReleaseManifest,
  payload: GatewayPayloadManifest,
): Promise<boolean> {
  const control = join(versionDir, ".install-complete.json")
  const completion = await readJson(control)
  if (!completion || !completionMatches(completion, release)) return false
  if (!await fileExists(join(versionDir, "dist", "index.js"))) return false
  const releaseOnDisk = await readJson(join(versionDir, "release-manifest.json"))
  if (!releaseOnDisk) return false
  try {
    const parsed = parseGatewayReleaseManifest(releaseOnDisk)
    if (parsed.payloadManifestSha256 !== release.payloadManifestSha256) return false
    if (parsed.gatewayVersion !== release.gatewayVersion) return false
  } catch {
    return false
  }
  const payloadOnDisk = await readJson(join(versionDir, "payload-manifest.json"))
  try {
    const parsedPayload = parseGatewayPayloadManifest(payloadOnDisk)
    if (JSON.stringify(parsedPayload) !== JSON.stringify(payload)) return false
  } catch {
    return false
  }
  return true
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function installGatewayPayload(input: {
  sourceRoot: string
  versionsRoot: string
  release: GatewayReleaseManifest
  payload: GatewayPayloadManifest
  deps?: InstallDeps
}): Promise<{ status: "reused" | "installed"; versionDir: string; entry: string }> {
  const payloadId = gatewayPayloadId(input.release.gatewayVersion, input.release.payloadManifestSha256)
  const versionDir = join(input.versionsRoot, payloadId)
  const entry = join(versionDir, "dist", "index.js")

  if (await payloadIsComplete(versionDir, input.release, input.payload)) {
    return { status: "reused", versionDir, entry }
  }

  const stagingRoot = join(dirname(input.versionsRoot), "staging")
  const stagingDir = join(stagingRoot, input.deps?.randomId?.() ?? randomUUID())
  try {
    await mkdir(stagingRoot, { recursive: true })
    await cp(input.sourceRoot, stagingDir, {
      recursive: true,
      force: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    await verifyGatewayPayload(stagingDir, input.payload, {
      read: async (rel) => readFile(join(stagingDir, rel)),
      stat: async (rel) => {
        const value = await stat(join(stagingDir, rel))
        return { size: value.size }
      },
      sha256,
    })
    if (!await fileExists(join(stagingDir, "dist", "index.js"))) {
      throw new Error("gateway payload is missing dist/index.js")
    }

    const completion: CompletionRecord = {
      schemaVersion: 1,
      gatewayVersion: input.release.gatewayVersion,
      schemaEpoch: input.release.schemaEpoch,
      payloadManifestSha256: input.release.payloadManifestSha256,
      installedAt: input.deps?.now?.() ?? new Date().toISOString(),
    }
    await writeFile(
      join(stagingDir, "payload-manifest.json"),
      `${JSON.stringify(input.payload, null, 2)}\n`,
      "utf8",
    )
    await writeFile(
      join(stagingDir, "release-manifest.json"),
      `${JSON.stringify(input.release, null, 2)}\n`,
      "utf8",
    )
    await writeFile(
      join(stagingDir, ".install-complete.json"),
      `${JSON.stringify(completion, null, 2)}\n`,
      "utf8",
    )

    await mkdir(input.versionsRoot, { recursive: true })
    await rm(versionDir, { recursive: true, force: true })
    await rename(stagingDir, versionDir)
    return { status: "installed", versionDir, entry }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
