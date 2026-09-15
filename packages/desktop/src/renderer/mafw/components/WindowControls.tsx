import { createSignal, onCleanup, onMount, Show } from "solid-js"

const isWin32 = window.api.platform === "win32"

export function WindowControls() {
  const [maximized, setMaximized] = createSignal(false)

  onMount(() => {
    void window.api.windowControls.isMaximized().then(setMaximized)
    const unsub = window.api.windowControls.onMaximizedChange(setMaximized)
    onCleanup(unsub)
  })

  return (
    <Show when={isWin32}>
      <div class="mafw-window-controls">
        <button
          class="mafw-wc-btn"
          aria-label="最小化"
          onClick={() => void window.api.windowControls.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button
          class="mafw-wc-btn"
          aria-label={maximized() ? "还原" : "最大化"}
          onClick={() => void window.api.windowControls.toggleMaximize()}
        >
          <Show
            when={maximized()}
            fallback={
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
              </svg>
            }
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5V1h7v7H8" fill="none" stroke="currentColor" />
              <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
            </svg>
          </Show>
        </button>
        <button
          class="mafw-wc-btn mafw-wc-close"
          aria-label="关闭"
          onClick={() => void window.api.windowControls.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.7 0.7L9.3 9.3M9.3 0.7L0.7 9.3" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </Show>
  )
}
