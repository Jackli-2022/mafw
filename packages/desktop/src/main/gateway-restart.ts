import { isGatewayDiscoveryFresh, type GatewayDiscoveryRecord } from "./gateway-discovery"
import type { GatewayHealthSnapshot } from "./gateway-handshake"

export type GatewayLocalRestartReason =
  | "ok"
  | "starting"
  | "no-discovery"
  | "stale-discovery"
  | "identity-mismatch"

export interface GatewayLocalRestartDecision {
  allowed: boolean
  reason: GatewayLocalRestartReason
  hint: string | null
}

/**
 * A local-build restart is only safe when the discovery record and /health
 * describe the same live process. A legacy gateway has no discovery record,
 * so we refuse and point the user at the CLI instead of killing an arbitrary
 * process.
 */
export function decideLocalBuildRestart(input: {
  state: "stopped" | "starting" | "ready" | "failed" | "conflict"
  discovery: GatewayDiscoveryRecord | null
  health: GatewayHealthSnapshot | null
  now?: number
  staleMs?: number
}): GatewayLocalRestartDecision {
  if (input.state === "starting") {
    return { allowed: false, reason: "starting", hint: "Gateway 仍在启动中，请稍后重试。" }
  }
  if (!input.discovery) {
    return {
      allowed: false,
      reason: "no-discovery",
      hint: "当前 gateway 没有发现文件；请使用 `mafw stop` 或 `mafw restart`。",
    }
  }
  if (!isGatewayDiscoveryFresh(input.discovery, input.now ?? Date.now(), input.staleMs ?? 30_000)) {
    return {
      allowed: false,
      reason: "stale-discovery",
      hint: "当前 gateway 的发现文件已过期；请使用 `mafw stop` 或 `mafw restart`。",
    }
  }
  const health = input.health
  if (!health || health.pid !== input.discovery.pid || health.instanceId !== input.discovery.instanceId) {
    return {
      allowed: false,
      reason: "identity-mismatch",
      hint: "拒绝停止不是该实例的进程；请先用 `mafw status` 检查。",
    }
  }
  return { allowed: true, reason: "ok", hint: null }
}
