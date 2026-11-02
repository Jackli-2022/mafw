// 鲸群 rail 徽标：只计人类 attention；未读与可查看结果分开显示。
// 纯函数，无 Solid 依赖。

export type PodUnreadMessage = {
  readAt?: string | null
  fromMemberId: string
  toMemberId: string | null
}

/** 未读 = 未标记已读、不是我发的、发给我的或广播。 */
export function countUnread(messages: PodUnreadMessage[], selfMemberId: string | null): number {
  if (!selfMemberId) return 0
  return messages.filter((message) =>
    !message.readAt
    && message.fromMemberId !== selfMemberId
    && (message.toMemberId === selfMemberId || message.toMemberId === null)).length
}

export function podRailBadge(input: {
  attention: Array<unknown>
  /** 显式声明不参与：未读不是人类阻塞点（Task 21）。 */
  unread?: number
  /** 显式声明不参与：有新结果也不是人类阻塞点（Task 21）。 */
  resultReady?: boolean
}): number {
  // Unread is deliberately not added: the badge means "the team cannot move
  // without you", not "something happened". Result-ready is a separate dot
  // (`podResultBadge`) because a finished Goal needs no blocking action.
  return input.attention.length
}

/** 徽标文案：0 不显示，>9 收敛为 9+。 */
export function formatRailBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ""
  return n > 9 ? "9+" : String(n)
}

/**
 * 结果标记（Task 21）：只有「有结果且还没看过」才显示。
 * 与 attention 数字徽标视觉/语义分开——结果不阻塞团队，也不要求立即行动。
 */
export function podResultBadge(input: {
  resultReady?: boolean | null
  viewed: boolean
}): "result" | null {
  return input.resultReady && !input.viewed ? "result" : null
}

/** 已查看结果的存储键：按 pod/goal/revision 隔离，旧版结果不会因新版而变成已读。 */
export function resultViewedKey(podId: string, goalId: string, revision: number): string {
  return `${podId}:${goalId}:${revision}`
}

/** 追加已查看键：去重、保留最新（新键放尾部，超出上限丢最旧）。 */
export function addViewedResult(keys: string[], key: string, max = 200): string[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 200
  const next = keys.filter((item) => item !== key)
  next.push(key)
  return next.slice(-limit)
}

/** localStorage 原文 → 键数组（坏数据 fail-open 为空）。 */
export function parseViewedResults(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && !!item) : []
  } catch {
    return []
  }
}
