// 内容意图：阅读是默认打开方式，修改是显式动作（首次输入也会自动进入修改）。
// 验收不是内容意图，而是 Goal 结果上的动作；它通过内容头部的「验收」快捷入口回到 Goal。
export type ContentIntent = "reading" | "editing"

export const CONTENT_INTENTS: readonly { id: ContentIntent; label: string }[] = [
  { id: "reading", label: "阅读" },
  { id: "editing", label: "修改" },
]

const INTENT_IDS = new Set<string>(CONTENT_INTENTS.map((item) => item.id))

export function normalizeContentIntent(value: string | null | undefined): ContentIntent {
  return value && INTENT_IDS.has(value) ? (value as ContentIntent) : "reading"
}

export function contentIntentLabel(value: string | null | undefined): string {
  const intent = normalizeContentIntent(value)
  return CONTENT_INTENTS.find((item) => item.id === intent)?.label ?? "阅读"
}

/** 内容 surface 的标签：打开文档后直接显示文档名，而不是泛化的「文件」。 */
export function contentDocumentLabel(rel: string | null | undefined): string {
  const name = (rel ?? "").split(/[/\\]/).pop()?.trim()
  return name || "文件"
}

/**
 * 打开模式：阅读默认临时预览；修改或显式 persist（文件树明确打开）→ 持久 tab。
 * persist 只影响 tab 生命周期，不改 lens。
 */
export function openModeForTab(input: { intent: ContentIntent; persist?: boolean }): "preview" | "persistent" {
  return input.persist === true || input.intent === "editing" ? "persistent" : "preview"
}
