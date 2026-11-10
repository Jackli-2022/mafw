import type { GatewayInstanceRecord } from "./gateway-instance-record"

export type GatewaySourcePreference = "managed" | "external"

export interface GatewayReleaseExpectation {
  gatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
  channel: string
}

export interface GatewayHealthSnapshot {
  status?: string
  gatewayVersion?: string
  experienceVersion?: string
  minimumClientExperienceVersion?: string
  schemaEpoch?: number
  channel?: string
  instanceId?: string
  distribution?: string
  pid?: number
}

export type GatewayHandshakeResult =
  | { ok: true; exactVersion: boolean }
  | {
    ok: false
    reason:
      | "legacy-unversioned"
      | "older-than-required"
      | "newer-than-desktop"
      | "schema-mismatch"
      | "channel-mismatch"
      | "experience-incompatible"
      | "instance-mismatch"
  }

function versionParts(value: unknown): number[] | null {
  if (typeof value !== "string") return null
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function compareGatewayVersions(left: unknown, right: unknown): number | null {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return null
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  return 0
}

function experienceCompatible(health: GatewayHealthSnapshot, expected: GatewayReleaseExpectation): boolean {
  const serverVersion = versionParts(health.experienceVersion)
  const serverMinimumClient = versionParts(health.minimumClientExperienceVersion)
  const clientVersion = versionParts(expected.experienceVersion)
  const clientMinimum = versionParts(expected.minimumClientExperienceVersion)
  if (!serverVersion || !serverMinimumClient || !clientVersion || !clientMinimum) return false
  const serverMeetsClientFloor = compareGatewayVersions(health.experienceVersion, expected.minimumClientExperienceVersion)
  const clientMeetsServerFloor = compareGatewayVersions(expected.experienceVersion, health.minimumClientExperienceVersion)
  return serverMeetsClientFloor !== null && serverMeetsClientFloor >= 0
    && clientMeetsServerFloor !== null && clientMeetsServerFloor >= 0
}

export function negotiateGateway(input: {
  mode: "managed" | "external"
  health: GatewayHealthSnapshot
  expected: GatewayReleaseExpectation
  expectedInstanceId?: string | null
}): GatewayHandshakeResult {
  const comparison = compareGatewayVersions(input.health.gatewayVersion, input.expected.gatewayVersion)
  if (comparison === null) return { ok: false, reason: "legacy-unversioned" }
  if (comparison < 0) return { ok: false, reason: "older-than-required" }
  if (input.mode === "managed" && comparison > 0) return { ok: false, reason: "newer-than-desktop" }
  if (input.health.schemaEpoch !== input.expected.schemaEpoch) {
    return { ok: false, reason: "schema-mismatch" }
  }

  if (input.mode === "managed") {
    if (input.health.channel !== input.expected.channel) {
      return { ok: false, reason: "channel-mismatch" }
    }
    if (input.expectedInstanceId && input.health.instanceId !== input.expectedInstanceId) {
      return { ok: false, reason: "instance-mismatch" }
    }
    if (!experienceCompatible(input.health, input.expected)) {
      return { ok: false, reason: "experience-incompatible" }
    }
    return { ok: true, exactVersion: true }
  }

  if (!experienceCompatible(input.health, input.expected)) {
    return { ok: false, reason: "experience-incompatible" }
  }
  return { ok: true, exactVersion: comparison === 0 }
}

export type { GatewayInstanceRecord }
