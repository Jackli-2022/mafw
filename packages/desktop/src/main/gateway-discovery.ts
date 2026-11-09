import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const GATEWAY_DISCOVERY_FILE = "gateway.json"

export interface GatewayDiscoveryRecord {
  instanceId: string
  pid: number
  port: number
  gatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
  channel: string
  distribution: string
  origin: string
  startedAt: string
  heartbeatAt: string
}

export function gatewayRuntimeDir(homeDir: string = homedir()): string {
  return join(homeDir, ".mafw", "runtime")
}

export function gatewayDiscoveryPath(runtimeDir: string = gatewayRuntimeDir()): string {
  return join(runtimeDir, GATEWAY_DISCOVERY_FILE)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function parseGatewayDiscovery(value: unknown): GatewayDiscoveryRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const instanceId = text(raw.instanceId)
  const gatewayVersion = text(raw.gatewayVersion)
  const experienceVersion = text(raw.experienceVersion)
  const minimumClientExperienceVersion = text(raw.minimumClientExperienceVersion)
  const channel = text(raw.channel)
  const distribution = text(raw.distribution)
  const origin = text(raw.origin)
  const startedAt = text(raw.startedAt)
  const heartbeatAt = text(raw.heartbeatAt)
  const pid = raw.pid
  const port = raw.port
  const schemaEpoch = raw.schemaEpoch
  if (!instanceId || !gatewayVersion || !experienceVersion || !minimumClientExperienceVersion) return null
  if (!channel || !distribution || !origin || !startedAt || !heartbeatAt) return null
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof schemaEpoch !== "number" || !Number.isInteger(schemaEpoch) || schemaEpoch <= 0) return null
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(heartbeatAt))) return null
  return {
    instanceId,
    pid,
    port,
    gatewayVersion,
    experienceVersion,
    minimumClientExperienceVersion,
    schemaEpoch,
    channel,
    distribution,
    origin,
    startedAt,
    heartbeatAt,
  }
}

export async function readGatewayDiscovery(
  runtimeDir: string = gatewayRuntimeDir(),
): Promise<GatewayDiscoveryRecord | null> {
  try {
    return parseGatewayDiscovery(JSON.parse(await readFile(gatewayDiscoveryPath(runtimeDir), "utf8")))
  } catch {
    return null
  }
}

export function isGatewayDiscoveryFresh(
  record: GatewayDiscoveryRecord,
  now: number = Date.now(),
  staleMs = 30_000,
): boolean {
  return now - Date.parse(record.heartbeatAt) <= staleMs
}
