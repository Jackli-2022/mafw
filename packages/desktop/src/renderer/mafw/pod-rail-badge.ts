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
}): number {
  // Unread is deliberately not added: the badge means "the team cannot move
  // without you", not "something happened".
  return input.attention.length
}

/** 徽标文案：0 不显示，>9 收敛为 9+。 */
export function formatRailBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ""
  return n > 9 ? "9+" : String(n)
}
