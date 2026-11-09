import type { CliProbe } from "./mafw-cli-probe"
import {
  negotiateGateway,
  type GatewayHealthSnapshot,
  type GatewayInstanceRecord,
  type GatewayReleaseExpectation,
  type GatewaySourcePreference,
} from "./gateway-handshake"

export type GatewayStartPlan =
  | { mode: "managed"; entry: string; action: "spawn" | "adopt"; instanceId?: string }
  | { mode: "external"; transport: "url" | "cli"; url: string | null; warning: "legacy-unverified" | null }
  | {
    mode: "conflict"
    reason:
      | "external-unregistered"
      | "managed-newer"
      | "channel-mismatch"
      | "schema-mismatch"
      | "port-conflict"
      | "legacy-external-unverified"
    detail: string
  }
  | { mode: "failed"; reason: string }

const DEFAULT_EXTERNAL_URL = "http://127.0.0.1:3000"

function managedEntryFor(input: {
  packaged: boolean
  bundledEntry: string | null
  managedEntry: string | null
}): string | null {
  return input.packaged ? input.bundledEntry : input.managedEntry
}

export function planGatewayStart(input: {
  packaged: boolean
  preference: GatewaySourcePreference
  expected: GatewayReleaseExpectation
  bundledEntry: string | null
  managedEntry: string | null
  externalCli: CliProbe
  running:
    | { kind: "none" }
    | { kind: "gateway"; health: GatewayHealthSnapshot; managedInstance: GatewayInstanceRecord | null }
    | { kind: "port-conflict" }
  legacyExternalOverride: boolean
}): GatewayStartPlan {
  if (input.running.kind === "port-conflict") {
    return {
      mode: "conflict",
      reason: "port-conflict",
      detail: "port 3000 is occupied by a process that is not a MAFW gateway",
    }
  }

  if (input.preference === "external") {
    if (input.running.kind === "gateway") {
      const handshake = negotiateGateway({
        mode: "external",
        health: input.running.health,
        expected: input.expected,
      })
      if (handshake.ok) {
        return { mode: "external", transport: "url", url: DEFAULT_EXTERNAL_URL, warning: null }
      }
      if (handshake.reason === "legacy-unversioned") {
        if (!input.legacyExternalOverride) {
          return {
            mode: "conflict",
            reason: "legacy-external-unverified",
            detail: "the running gateway does not advertise a verifiable release version",
          }
        }
        return { mode: "external", transport: "url", url: DEFAULT_EXTERNAL_URL, warning: "legacy-unverified" }
      }
      return {
        mode: "failed",
        reason: `external gateway is incompatible: ${handshake.reason}`,
      }
    }
    if (input.externalCli.available) {
      return { mode: "external", transport: "cli", url: null, warning: null }
    }
    return {
      mode: "failed",
      reason: `no external gateway URL and mafw CLI unavailable: ${input.externalCli.reason}`,
    }
  }

  const entry = managedEntryFor(input)
  if (!entry) {
    return {
      mode: "failed",
      reason: input.packaged
        ? "packaged app has no bundled gateway entry"
        : "no managed gateway entry is available in this development build",
    }
  }

  if (input.running.kind === "gateway") {
    const instance = input.running.managedInstance
    if (
      !instance
      || input.running.health.distribution !== "desktop-managed"
      || input.running.health.instanceId !== instance.instanceId
    ) {
      return {
        mode: "conflict",
        reason: "external-unregistered",
        detail: "a gateway is running but it is not registered to this desktop release",
      }
    }

    const handshake = negotiateGateway({
      mode: "managed",
      health: input.running.health,
      expected: input.expected,
      expectedInstanceId: instance.instanceId,
    })
    if (handshake.ok) {
      return { mode: "managed", entry, action: "adopt", instanceId: instance.instanceId }
    }
    if (handshake.reason === "older-than-required") {
      return { mode: "managed", entry, action: "spawn" }
    }
    if (handshake.reason === "newer-than-desktop") {
      return {
        mode: "conflict",
        reason: "managed-newer",
        detail: "the registered managed gateway is newer than this desktop release",
      }
    }
    if (handshake.reason === "schema-mismatch") {
      return {
        mode: "conflict",
        reason: "schema-mismatch",
        detail: "the registered managed gateway uses a different data schema epoch",
      }
    }
    if (handshake.reason === "channel-mismatch") {
      return {
        mode: "conflict",
        reason: "channel-mismatch",
        detail: "the registered managed gateway belongs to another desktop channel",
      }
    }
    if (handshake.reason === "instance-mismatch") {
      return {
        mode: "conflict",
        reason: "external-unregistered",
        detail: "the running instance does not match its registration record",
      }
    }
    return {
      mode: "failed",
      reason: `managed gateway handshake failed: ${handshake.reason}`,
    }
  }

  return { mode: "managed", entry, action: "spawn" }
}
