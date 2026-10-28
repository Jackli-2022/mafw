export interface GuardFacts {
  tagName: string
  isEditable: boolean
  hasSelection: boolean
  isMediaOrLink: boolean
  forceNative: boolean
}

export function shouldUseNativeMenu(facts: GuardFacts): boolean {
  return facts.forceNative
}

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true'], [data-native-menu]"
const MEDIA_SELECTOR = "img, video, audio, a[href]:not([data-file-path])"

export function guardFactsFromEvent(event: MouseEvent): GuardFacts {
  const target = event.target as HTMLElement | null
  const editable = target?.closest?.(EDITABLE_SELECTOR) as HTMLElement | null
  const media = !!target?.closest?.(MEDIA_SELECTOR)

  const selection = typeof window !== "undefined" ? window.getSelection() : null
  const selectingMessage = !!selection && !selection.isCollapsed && !!target?.closest?.("[data-message]")

  return {
    tagName: target?.tagName ?? "",
    isEditable: !!editable,
    hasSelection: selectingMessage,
    isMediaOrLink: media,
    forceNative: !!editable?.hasAttribute?.("data-native-menu"),
  }
}
