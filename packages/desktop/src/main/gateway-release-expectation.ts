import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { GatewayReleaseExpectation } from "./gateway-handshake"

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`release.json field ${field} is missing`)
  return value.trim()
}

export function readGatewayReleaseExpectation(entry: string, channel: string): GatewayReleaseExpectation {
  const file = join(dirname(entry), "release.json")
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    const schemaEpoch = raw.schemaEpoch
    if (typeof schemaEpoch !== "number" || !Number.isInteger(schemaEpoch) || schemaEpoch <= 0) {
      throw new Error("release.json field schemaEpoch is invalid")
    }
    return {
      gatewayVersion: text(raw.gatewayVersion, "gatewayVersion"),
      experienceVersion: text(raw.experienceVersion, "experienceVersion"),
      minimumClientExperienceVersion: text(
        raw.minimumClientExperienceVersion,
        "minimumClientExperienceVersion",
      ),
      schemaEpoch,
      channel,
    }
  } catch (err: any) {
    throw new Error(`failed to read gateway release metadata from ${file}: ${err?.message ?? err}`)
  }
}
