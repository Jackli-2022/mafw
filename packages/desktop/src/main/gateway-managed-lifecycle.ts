import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import {
  parseGatewayPayloadManifest,
  parseGatewayReleaseManifest,
  type GatewayPayloadManifest,
  type GatewayReleaseManifest,
} from "./gateway-release-manifest"
import { installGatewayPayload } from "./gateway-payload-installer"
import {
  clearQuarantine,
  readCurrentPointer,
  readPreviousPointer,
  readQuarantine,
  writeCurrentPointer,
  writeQuarantine,
  type ManagedPointer,
} from "./gateway-managed-store"
import type { GatewayReleaseExpectation } from "./gateway-handshake"

export type ManagedLifecycleResult =
  | { kind: "start"; entry: string; versionDir: string; version: string }
  | { kind: "quarantined"; version: string; error: string }
  | { kind: "blocked"; reason: "schema-mismatch"; expectedSchemaEpoch: number; actualSchemaEpoch: number }
  | { kind: "failed"; reason: string }

export interface PrepareDeps {
  now?(): string
  randomId?(): string
}

export interface FailureDeps {
  now?(): string
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function pointerMatches(
  pointer: ManagedPointer,
  release: GatewayReleaseManifest,
): boolean {
  return pointer.version === release.gatewayVersion
    && pointer.payloadManifestSha256 === release.payloadManifestSha256
}

async function installedPayloadIsComplete(
  versionDir: string,
  pointer: ManagedPointer,
): Promise<boolean> {
  const marker = await readJson(join(versionDir, ".install-complete.json")).catch(() => null) as any
  if (!marker || marker.schemaVersion !== 1) return false
  if (marker.gatewayVersion !== pointer.version) return false
  if (marker.payloadManifestSha256 !== pointer.payloadManifestSha256) return false
  if (!await exists(join(versionDir, "dist", "index.js"))) return false

  let releaseOnDisk: GatewayReleaseManifest
  let payloadOnDisk: GatewayPayloadManifest
  try {
    releaseOnDisk = parseGatewayReleaseManifest(
      await readJson(join(versionDir, "release-manifest.json")),
    )
    payloadOnDisk = parseGatewayPayloadManifest(
      await readJson(join(versionDir, "payload-manifest.json")),
    )
  } catch {
    return false
  }
  if (releaseOnDisk.payloadManifestSha256 !== pointer.payloadManifestSha256) return false
  if (releaseOnDisk.gatewayVersion !== pointer.version) return false
  if (marker.schemaEpoch !== releaseOnDisk.schemaEpoch) return false

  const nativeRel = "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  if (payloadOnDisk.files.some((file) => file.path === nativeRel)) {
    if (!await exists(join(versionDir, nativeRel))) return false
  }
  return true
}

function expectedMatches(
  release: GatewayReleaseManifest,
  expected: GatewayReleaseExpectation,
): boolean {
  return release.gatewayVersion === expected.gatewayVersion
    && release.experienceVersion === expected.experienceVersion
    && release.minimumClientExperienceVersion === expected.minimumClientExperienceVersion
    && release.schemaEpoch === expected.schemaEpoch
}

export async function prepareManagedGateway(input: {
  resourcesRoot: string
  managedRoot: string
  expected: GatewayReleaseExpectation
  canReplaceRunning: boolean
  forceRetry: boolean
  deps: PrepareDeps
}): Promise<ManagedLifecycleResult> {
  void input.canReplaceRunning
  let release: GatewayReleaseManifest
  let payload: GatewayPayloadManifest
  let digest: string
  try {
    release = parseGatewayReleaseManifest(
      await readJson(join(input.resourcesRoot, "release-manifest.json")),
    )
    payload = parseGatewayPayloadManifest(
      await readJson(join(input.resourcesRoot, "payload-manifest.json")),
    )
    digest = sha256(Buffer.from(JSON.stringify(payload), "utf8"))
    if (digest !== release.payloadManifestSha256) {
      return { kind: "failed", reason: "resource payload digest disagrees with release manifest" }
    }
    if (!expectedMatches(release, input.expected)) {
      return { kind: "failed", reason: "bundled gateway release does not match the desktop expectation" }
    }
  } catch (error: any) {
    return { kind: "failed", reason: `invalid bundled gateway release: ${error?.message ?? error}` }
  }

  const current = readCurrentPointer(input.managedRoot)
  const currentDir = current ? join(input.managedRoot, "versions", current.versionDir) : null
  const currentComplete = !!(current && currentDir && await installedPayloadIsComplete(currentDir, current))
  const startCurrent = () => {
    return {
      kind: "start" as const,
      entry: join(currentDir!, "dist", "index.js"),
      versionDir: currentDir!,
      version: current!.version,
    }
  }

  const quarantine = readQuarantine(input.managedRoot)
  const sameQuarantine = !!quarantine
    && quarantine.version === release.gatewayVersion
    && quarantine.payloadManifestSha256 === release.payloadManifestSha256
  if (sameQuarantine && !input.forceRetry) {
    if (currentComplete && current!.payloadManifestSha256 !== release.payloadManifestSha256) {
      return startCurrent()
    }
    return { kind: "quarantined", version: quarantine!.version, error: quarantine!.error }
  }
  if (quarantine && (input.forceRetry || !sameQuarantine)) {
    await clearQuarantine(input.managedRoot)
  }

  if (currentComplete && pointerMatches(current!, release)) {
    return startCurrent()
  }

  try {
    const installed = await installGatewayPayload({
      sourceRoot: input.resourcesRoot,
      versionsRoot: join(input.managedRoot, "versions"),
      release,
      payload,
      deps: {
        now: input.deps.now,
        randomId: input.deps.randomId,
      },
    })
    const pointer: ManagedPointer = {
      version: release.gatewayVersion,
      payloadManifestSha256: release.payloadManifestSha256,
      versionDir: basename(installed.versionDir),
      installedAt: input.deps.now?.() ?? new Date().toISOString(),
    }
    await writeCurrentPointer(input.managedRoot, pointer)
    return {
      kind: "start",
      entry: installed.entry,
      versionDir: installed.versionDir,
      version: release.gatewayVersion,
    }
  } catch (error: any) {
    return { kind: "failed", reason: `gateway payload install failed: ${error?.message ?? error}` }
  }
}

export async function recordManagedStartFailure(input: {
  managedRoot: string
  release: GatewayReleaseManifest
  error: string
  previousAvailable: boolean
  schemaChanged: boolean
  deps: FailureDeps
}): Promise<{ restartPointer: ManagedPointer | null; blocked: boolean }> {
  await writeQuarantine(input.managedRoot, {
    version: input.release.gatewayVersion,
    payloadManifestSha256: input.release.payloadManifestSha256,
    error: input.error,
    failedAt: input.deps.now?.() ?? new Date().toISOString(),
  })
  if (input.schemaChanged) {
    return { restartPointer: null, blocked: true }
  }
  const previous = input.previousAvailable ? readPreviousPointer(input.managedRoot) : null
  if (!previous) return { restartPointer: null, blocked: false }
  await writeCurrentPointer(input.managedRoot, previous)
  return { restartPointer: previous, blocked: false }
}
