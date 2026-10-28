import { onCleanup, onMount } from "solid-js"
import { menuController } from "./controller"
import { buildTextMenu } from "./builders/text"

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']"

function editableSelection(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.selectionStart !== null && el.selectionEnd !== null && el.selectionStart !== el.selectionEnd
  }
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && el.contains(selection.anchorNode)
}

export function TextMenuBridge() {
  onMount(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      const editable = target.closest(EDITABLE_SELECTOR) as HTMLElement | null
      const selection = window.getSelection()
      const selectedText = selection && !selection.isCollapsed ? selection.toString() : ""

      if (!editable && !selectedText) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (editable) editable.focus({ preventScroll: true })

      menuController.request(
        buildTextMenu,
        {
          editable: !!editable,
          hasSelection: editable ? editableSelection(editable) : !!selectedText,
          canPaste: !!editable,
        },
        (id) => {
          if (id === "text.cut") {
            editable?.focus({ preventScroll: true })
            void window.api.edit.cut()
          } else if (id === "text.copy") {
            if (editable) {
              editable.focus({ preventScroll: true })
              void window.api.edit.copy()
            } else if (selectedText) {
              void navigator.clipboard.writeText(selectedText)
            }
          } else if (id === "text.paste") {
            editable?.focus({ preventScroll: true })
            void window.api.edit.paste()
          } else if (id === "text.selectAll") {
            editable?.focus({ preventScroll: true })
            void window.api.edit.selectAll()
          }
        },
        { point: { x: event.clientX, y: event.clientY }, returnFocus: editable ?? target },
      )
    }

    document.addEventListener("contextmenu", onContextMenu, true)
    onCleanup(() => document.removeEventListener("contextmenu", onContextMenu, true))
  })

  return null
}
