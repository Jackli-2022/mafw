import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GATEWAY_DISCOVERY_FILE, mafwRuntimeDir } from "./runtime-paths"

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

export interface PublishGatewayDiscoveryInput {
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
  now?: () => number
}

export interface GatewayDiscoveryHandle {
  readonly record: GatewayDiscoveryRecord
  heartbeat(at?: Date): Promise<void>
  release(): Promise<void>
}

export function gatewayDiscoveryPath(runtimeDir: string = mafwRuntimeDir()): string {
  return join(runtimeDir, GATEWAY_DISCOVERY_FILE)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseRecord(value: unknown): GatewayDiscoveryRecord | null {
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
  runtimeDir: string = mafwRuntimeDir(),
): Promise<GatewayDiscoveryRecord | null> {
  try {
    return parseRecord(JSON.parse(await readFile(gatewayDiscoveryPath(runtimeDir), "utf8")))
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

async function writeRecordAtomic(
  runtimeDir: string,
  record: GatewayDiscoveryRecord,
): Promise<void> {
  await mkdir(runtimeDir, { recursive: true })
  const path = gatewayDiscoveryPath(runtimeDir)
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  await writeFile(temp, JSON.stringify(record), "utf8")
  try {
    await rename(temp, path)
  } catch (err) {
    await rm(temp, { force: true })
    throw err
  }
}

export async function publishGatewayDiscovery(
  input: PublishGatewayDiscoveryInput,
  runtimeDir: string = mafwRuntimeDir(),
): Promise<GatewayDiscoveryHandle> {
  const now = input.now ?? Date.now
  let record: GatewayDiscoveryRecord = {
    instanceId: input.instanceId,
    pid: input.pid,
    port: input.port,
    gatewayVersion: input.gatewayVersion,
    experienceVersion: input.experienceVersion,
    minimumClientExperienceVersion: input.minimumClientExperienceVersion,
    schemaEpoch: input.schemaEpoch,
    channel: input.channel,
    distribution: input.distribution,
    origin: input.origin,
    startedAt: new Date(now()).toISOString(),
    heartbeatAt: new Date(now()).toISOString(),
  }
  await writeRecordAtomic(runtimeDir, record)

  return {
    get record() {
      return record
    },
    async heartbeat(at: Date = new Date()): Promise<void> {
      const current = await readGatewayDiscovery(runtimeDir)
      if (!current || current.instanceId !== record.instanceId) {
        throw new Error("gateway discovery was taken over by another instance")
      }
      record = { ...record, heartbeatAt: at.toISOString() }
      await writeRecordAtomic(runtimeDir, record)
    },
    async release(): Promise<void> {
      const current = await readGatewayDiscovery(runtimeDir)
      if (!current || current.instanceId !== record.instanceId) return
      await rm(gatewayDiscoveryPath(runtimeDir), { force: true })
    },
  }
}
