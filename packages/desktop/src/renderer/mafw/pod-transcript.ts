export type PodTranscriptTurn = { role: "user" | "assistant" | "other"; text: string }

function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((part) => (typeof part === "string" ? part : part?.type === "text" ? String(part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
}

function textOfMessage(message: any): string {
  if (!message || typeof message !== "object") return ""
  if (message.content !== undefined) {
    const text = textOf(message.content)
    if (text) return text
  }
  return typeof message.text === "string" ? message.text : ""
}

function roleOf(message: any): PodTranscriptTurn["role"] {
  const role = message?.role
  return role === "user" || role === "assistant" ? role : "other"
}

/** 快照摄取：旧 `{info,parts}` 信封只在这里展开，渲染函数只读 flat。 */
function flatTranscriptMessage(message: any): any {
  if (!message || typeof message !== "object") return message
  if (message.info && typeof message.info === "object") {
    const content = Array.isArray(message.parts) ? message.parts : message.info.parts
    return content ? { ...message.info, content } : { ...message.info }
  }
  if (message.content === undefined && Array.isArray(message.parts)) {
    return { ...message, content: message.parts }
  }
  return message
}

export function transcriptTurns(snapshot: unknown): PodTranscriptTurn[] {
  const messages = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray((snapshot as any)?.messages)
      ? (snapshot as any).messages
      : []
  const turns: PodTranscriptTurn[] = []
  for (const raw of messages) {
    const message = flatTranscriptMessage(raw)
    const text = textOfMessage(message).trim()
    if (!text) continue
    turns.push({ role: roleOf(message), text })
  }
  return turns
}
