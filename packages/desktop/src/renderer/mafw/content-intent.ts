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
