import type { GatewayHealthSnapshot, GatewayInstanceRecord } from "./gateway-handshake"
import { isGatewayDiscoveryFresh, type GatewayDiscoveryRecord } from "./gateway-discovery"

export type RunningProbe =
  | { kind: "none" }
  | {
    kind: "gateway"
    health: GatewayHealthSnapshot
    managedInstance: GatewayInstanceRecord | null
    discovery: GatewayDiscoveryRecord | null
    port: number
  }
  | { kind: "port-conflict" }

export interface GatewayProbeDeps {
  readDiscovery(): Promise<GatewayDiscoveryRecord | null>
  readHealth(
    url: string,
    discovery: GatewayDiscoveryRecord | null,
  ): Promise<GatewayHealthSnapshot | null>
  readLegacyRecords(): Promise<GatewayInstanceRecord[]>
  tcpReachable(host: string, port: number): Promise<boolean>
  now?(): number
  legacyPort?: number
}

export function healthMatchesDiscovery(
  health: GatewayHealthSnapshot,
  discovery: GatewayDiscoveryRecord,
): boolean {
  return health.pid === discovery.pid && health.instanceId === discovery.instanceId
}

export function managedRecordFromDiscovery(discovery: GatewayDiscoveryRecord): GatewayInstanceRecord {
  return {
    instanceId: discovery.instanceId,
    pid: discovery.pid,
    channel: discovery.channel,
    gatewayVersion: discovery.gatewayVersion,
    schemaEpoch: discovery.schemaEpoch,
    startedAt: discovery.startedAt,
    nonce: "discovery",
  }
}

/**
 * Discovery first, legacy port probe second. A fresh discovery record is the
 * only source that can point at a non-default port; the 3000 probe exists for
 * gateways upgraded from a release that predates `gateway.json`.
 */
export async function probeGateway(deps: GatewayProbeDeps): Promise<RunningProbe> {
  const now = deps.now ?? Date.now
  const legacyPort = deps.legacyPort ?? 3000
  const discovery = await deps.readDiscovery()
  if (discovery && isGatewayDiscoveryFresh(discovery, now())) {
    const url = `http://127.0.0.1:${discovery.port}`
    const health = await deps.readHealth(url, discovery)
    if (health && healthMatchesDiscovery(health, discovery)) {
      const managedInstance = discovery.distribution === "desktop-managed"
        ? managedRecordFromDiscovery(discovery)
        : null
      return { kind: "gateway", health, managedInstance, discovery, port: discovery.port }
    }
  }

  const health = await deps.readHealth(`http://127.0.0.1:${legacyPort}`, null)
  if (health) {
    const records = await deps.readLegacyRecords()
    const managedInstance = health.instanceId
      ? records.find((record) => record.instanceId === health.instanceId) ?? null
      : null
    return { kind: "gateway", health, managedInstance, discovery: null, port: legacyPort }
  }
  if (await deps.tcpReachable("127.0.0.1", legacyPort)) return { kind: "port-conflict" }
  return { kind: "none" }
}
