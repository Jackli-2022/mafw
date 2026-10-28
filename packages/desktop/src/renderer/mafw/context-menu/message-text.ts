export interface TextPartLike {
  type?: string
  text?: unknown
}

function textOf(part: TextPartLike): string {
  return part.type === "text" && typeof part.text === "string" ? part.text : ""
}

export function textFromParts(parts: TextPartLike[]): string {
  return parts.map(textOf).filter((text) => text.length > 0).join("\n\n")
}

export function markdownFromParts(parts: TextPartLike[]): string {
  return textFromParts(parts)
}

export function codeFence(code: string, language?: string): string {
  const tag = language?.trim() || ""
  return `\`\`\`${tag}\n${code}\n\`\`\``
}
