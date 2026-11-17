// Floating notification window entry. A tiny Solid surface: main positions
// and sizes this window (transparent, always-on-top, non-focusable); here we
// only render the visible stack and report dismiss/hover/open back.
import { render } from "solid-js/web"
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { MafwNotification } from "../../shared/notifications"
import {
  applyNotificationTheme,
  notificationCardLabel,
  type FloatingPayload,
} from "./window-model"
import "./notification.css"

declare global {
  interface Window {
    notificationApi?: {
      onItems(cb: (payload: FloatingPayload) => void): () => void
      dismiss(id: string): void
      hover(id: string, hovering: boolean): void
      open(id: string): void
    }
  }
}

function FloatingNotifications() {
  const [payload, setPayload] = createSignal<FloatingPayload>({ items: [], theme: "dark" })

  const off = window.notificationApi?.onItems?.((next) => {
    applyNotificationTheme(document, next.theme)
    setPayload(next)
  })
  onCleanup(() => off?.())

  return (
    <For each={payload().items}>
      {(item: MafwNotification) => (
        <div
          class="nwin-card"
          classList={{ "is-p1": item.severity === "p1" }}
          role="button"
          tabIndex={-1}
          aria-label={notificationCardLabel(item)}
          onClick={() => window.notificationApi?.open(item.id)}
          onMouseEnter={() => window.notificationApi?.hover(item.id, true)}
          onMouseLeave={() => window.notificationApi?.hover(item.id, false)}
        >
          <div class="nwin-title">{item.title}</div>
          <Show when={item.body}>
            <div class="nwin-body">{item.body}</div>
          </Show>
          <div class="nwin-meta">
            <span class="nwin-reason">{item.reason}</span>
            <span
              class="nwin-close"
              role="button"
              tabIndex={-1}
              aria-label="关闭通知"
              onClick={(event) => {
                event.stopPropagation()
                window.notificationApi?.dismiss(item.id)
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" stroke-width="1.4" />
              </svg>
            </span>
          </div>
        </div>
      )}
    </For>
  )
}

render(() => <FloatingNotifications />, document.getElementById("root")!)
