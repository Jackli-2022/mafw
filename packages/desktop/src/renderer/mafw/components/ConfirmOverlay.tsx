// @ts-nocheck
import { Show, onMount, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

// Shared destructive-action confirmation (mafw-confirm styling). Replaces
// the blocking window.confirm() calls scattered across Rail / MafwShell /
// Config so every confirmation in the app behaves identically.
export function ConfirmOverlay(props: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.key === "Escape") { e.preventDefault(); props.onCancel() }
      else if (e.key === "Enter") { e.preventDefault(); props.onConfirm() }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={props.open}>
      <div class="mafw-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onCancel() }}>
        <div class="mafw-confirm">
          <div class="mafw-confirm-title">{props.title}</div>
          <Show when={props.message}>
            <div class="mafw-confirm-text">{props.message}</div>
          </Show>
          <div class="mafw-confirm-actions">
            <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>取消</ButtonV2>
            <ButtonV2
              variant="contrast"
              size="small"
              class="mafw-confirm-ok"
              style={props.danger ? { background: "#e8636b" } : undefined}
              onClick={props.onConfirm}
            >{props.confirmLabel || "确认"}</ButtonV2>
          </div>
        </div>
      </div>
    </Show>
  )
}
