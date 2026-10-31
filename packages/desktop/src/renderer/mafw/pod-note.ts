// 把一条 chatview 消息显式提升为鲸群协调记录（Slack「转发到频道」的等价物）。
// 不自动镜像：只有用户点「记入鲸群」才写一条 pod_messages 的 note。
// 研究结论见 docs/research/2026-10-31-agent-chat-vs-team-log.md。

export const POD_NOTE_MAX_CHARS = 400

export type PodNoteInput = {
  /** 发言人显示名（Lead / Builder / Reviewer / 你） */
  speaker: string
  sessionId: string
  messageId: string
  text: string
  maxChars?: number
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * 生成 Pod note 正文：`[来自 X 的会话] 摘要…` + 来源指针。
 * 文本为空返回 ""（调用方据此禁用菜单项）。
 */
export function buildPodNoteBody(input: PodNoteInput): string {
  const flat = squeeze(input.text)
  if (!flat) return ""
  const max = Math.max(40, input.maxChars ?? POD_NOTE_MAX_CHARS)
  const body = flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
  return [
    `[来自 ${input.speaker} 的会话] ${body}`,
    `会话 ${input.sessionId} / 消息 ${input.messageId}`,
  ].join("\n")
}
