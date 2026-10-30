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
  if (Array.isArray(message.parts)) {
    const text = message.parts
      .filter((part: any) => part?.type === "text" || (part?.type === undefined && typeof part?.text === "string"))
      .map((part: any) => String(part.text ?? ""))
      .filter(Boolean)
      .join("\n")
    if (text) return text
  }
  if (message.content !== undefined) {
    const text = textOf(message.content)
    if (text) return text
  }
  return typeof message.text === "string" ? message.text : ""
}

function roleOf(message: any): PodTranscriptTurn["role"] {
  const role = message?.info?.role ?? message?.role
  return role === "user" || role === "assistant" ? role : "other"
}

export function transcriptTurns(snapshot: unknown): PodTranscriptTurn[] {
  const messages = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray((snapshot as any)?.messages)
      ? (snapshot as any).messages
      : []
  const turns: PodTranscriptTurn[] = []
  for (const message of messages) {
    const text = textOfMessage(message).trim()
    if (!text) continue
    turns.push({ role: roleOf(message), text })
  }
  return turns
}
