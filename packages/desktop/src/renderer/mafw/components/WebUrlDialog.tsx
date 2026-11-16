import { createEffect, createSignal, Show, onMount, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { normalizeWebUrl } from "../chat/mention-sources"

export function WebUrlDialog(props: {
  open: boolean
  onClose: () => void
  onAdd: (url: string) => void
}) {
  const [draft, setDraft] = createSignal("")
  const [error, setError] = createSignal("")
  let wasOpen = false

  createEffect(() => {
    const open = props.open
    if (open && !wasOpen) {
      setDraft("")
      setError("")
    }
    wasOpen = open
  })

  const submit = () => {
    const url = normalizeWebUrl(draft())
    if (!url) {
      setError("请输入 http/https 链接")
      return
    }
    props.onAdd(url)
    props.onClose()
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopImmediatePropagation()
        props.onClose()
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopImmediatePropagation()
        submit()
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
          onClick={e => { if (e.target === e.currentTarget) props.onClose() }}
        >
          <div class="mafw-confirm" role="dialog" aria-modal="true" aria-label="添加网页">
            <div class="mafw-confirm-title">添加网页</div>
            <div class="mafw-web-field">
              <TextInputV2
                value={draft()}
                autofocus
                placeholder="https://example.com/docs"
                onInput={e => { setDraft(e.currentTarget.value); setError("") }}
              />
            </div>
            <Show when={error()}>
              <div class="mafw-web-error">{error()}</div>
            </Show>
            <div class="mafw-confirm-actions">
              <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>取消</ButtonV2>
              <ButtonV2 variant="contrast" size="small" disabled={!draft().trim()} onClick={submit}>添加</ButtonV2>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  )
}
