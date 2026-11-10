import type { GatewayStatus } from "@mafw/sdk"

export interface GatewayConfigView {
  sourceLabel: string
  versionLabel: string
  compatibility: "ok" | "conflict" | "unknown"
  canRestart: boolean
  canRetryQuarantined: boolean
  canUseManaged: boolean
  canUseExternal: boolean
  canUseExternalOnce: boolean
}

function versionParts(value: string | null | undefined): number[] | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null
}

function sameVersion(left: string | null, right: string | null): boolean | null {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return null
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function gatewayConfigView(status: GatewayStatus | null): GatewayConfigView {
  if (!status) {
    return {
      sourceLabel: "未知",
      versionLabel: "—",
      compatibility: "unknown",
      canRestart: false,
      canRetryQuarantined: false,
      canUseManaged: true,
      canUseExternal: true,
      canUseExternalOnce: false,
    }
  }

  const sourceLabel = status.attached
    ? status.attachedOrigin === "standalone"
      ? "已连接全局 gateway"
      : "已连接现有 gateway"
    : status.source === "managed"
      ? "受管 gateway"
      : status.source === "external"
        ? "外部 gateway"
        : "未知"
  const versionLabel = status.actualVersion && status.expectedVersion
    ? status.actualVersion === status.expectedVersion
      ? status.actualVersion
      : `实际 ${status.actualVersion} / 期望 ${status.expectedVersion}`
    : status.actualVersion
      ? `实际 ${status.actualVersion}`
      : status.expectedVersion
        ? `期望 ${status.expectedVersion}`
        : "—"

  const quarantined = !!status.quarantine
  const compatibility: GatewayConfigView["compatibility"] = quarantined || status.state === "conflict"
    ? status.actualVersion ? "conflict" : "unknown"
    : !status.actualVersion || !status.expectedVersion
      ? "unknown"
      : status.source === "external"
        ? "ok"
        : sameVersion(status.actualVersion, status.expectedVersion) ? "ok" : "conflict"

  return {
    sourceLabel,
    versionLabel,
    compatibility,
    canRestart: !quarantined && status.state !== "conflict",
    canRetryQuarantined: quarantined,
    canUseManaged: true,
    canUseExternal: true,
    canUseExternalOnce: status.source === "external" && !status.actualVersion,
  }
}

export function gatewayConflictGuidance(status: GatewayStatus): string | null {
  if (status.quarantine) {
    return `该 gateway payload 已多次启动失败：${status.quarantine.error}。请修复后手动重试，普通重启不会重复尝试它。`
  }
  if (status.source === "external" && !status.actualVersion) {
    return "当前外部 gateway 没有可验证的版本信息。你只能选择仅本次使用，重启后将回到受管 gateway。"
  }
  if (status.attached) {
    const origin = status.attachedOrigin === "standalone" ? "全局 gateway" : "已运行的 gateway"
    const version = status.actualVersion ? ` v${status.actualVersion}` : ""
    return `已连接${origin}${version}，Desktop 没有启动自己的 gateway；如需运行当前构建，请重启 gateway。`
  }
  if (status.source === "managed" && status.actualVersion && status.expectedVersion
    && !sameVersion(status.actualVersion, status.expectedVersion)) {
    return `当前运行的 gateway ${status.actualVersion} 与 Desktop 期望 ${status.expectedVersion} 不一致，可能正在使用上一版回滚 payload。`
  }
  if (status.state === "conflict") {
    return status.error || "gateway 来源或版本冲突，请显式选择受管或外部来源后重试。"
  }
  return null
}
