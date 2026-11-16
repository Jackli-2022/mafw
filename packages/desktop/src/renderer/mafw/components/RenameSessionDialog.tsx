import { createEffect, createSignal, Show, onMount, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"

export function RenameSessionDialog(props: {
  open: boolean
  initialTitle: string
  onClose: () => void
  onConfirm: (title: string) => Promise<void>
}) {
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  let wasOpen = false

  createEffect(() => {
    const open = props.open
    if (open && !wasOpen) {
      setDraft(props.initialTitle)
      setError("")
      setBusy(false)
    }
    wasOpen = open
  })

  const submit = async () => {
    const title = draft().trim()
    if (!title || busy()) return
    setBusy(true)
    setError("")
    try {
      await props.onConfirm(title)
      props.onClose()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!busy()) props.onClose()
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopImmediatePropagation()
        void submit()
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Portal>
      <Show when={props.open}>
        <div
          class="mafw-confirm-backdrop"
          onClick={e => { if (e.target === e.currentTarget && !busy()) props.onClose() }}
        >
          <div class="mafw-confirm" role="dialog" aria-modal="true" aria-label="重命名会话">
            <div class="mafw-confirm-title">重命名会话</div>
            <div class="mafw-rename-field">
              <TextInputV2
                value={draft()}
                autofocus
                placeholder="会话标题"
                onInput={e => setDraft(e.currentTarget.value)}
              />
            </div>
            <Show when={error()}>
              <div class="mafw-rename-error">{error()}</div>
            </Show>
            <div class="mafw-confirm-actions">
              <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={props.onClose}>取消</ButtonV2>
              <ButtonV2
                variant="contrast"
                size="small"
                disabled={busy() || !draft().trim()}
                onClick={() => void submit()}
              >
                {busy() ? "保存中…" : "保存"}
              </ButtonV2>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  )
}
