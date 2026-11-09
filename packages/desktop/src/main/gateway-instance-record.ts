export interface GatewayInstanceRecord {
  instanceId: string
  pid: number
  channel: string
  gatewayVersion: string
  schemaEpoch: number
  startedAt: string
  nonce: string
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function parseGatewayInstanceRecord(value: unknown): GatewayInstanceRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const instanceId = text(raw.instanceId)
  const channel = text(raw.channel)
  const gatewayVersion = text(raw.gatewayVersion)
  const startedAt = text(raw.startedAt)
  const nonce = text(raw.nonce)
  const pid = raw.pid
  const schemaEpoch = raw.schemaEpoch
  if (!instanceId || !channel || !gatewayVersion || !startedAt || !nonce) return null
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null
  if (typeof schemaEpoch !== "number" || !Number.isInteger(schemaEpoch) || schemaEpoch <= 0) return null
  return { instanceId, pid, channel, gatewayVersion, schemaEpoch, startedAt, nonce }
}
