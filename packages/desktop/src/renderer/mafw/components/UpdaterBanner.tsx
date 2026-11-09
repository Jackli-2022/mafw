import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { UpdaterState } from "../../../types/updater"
import { updaterBannerModel } from "../updater-banner-model"

const DISMISS_KEY = "mafw-updater-dismissed-version"

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/** A single non-modal action for an already-downloaded desktop update. */
export function UpdaterBanner() {
  const [state, setState] = createSignal<UpdaterState>({ status: "idle" })
  const [dismissed, setDismissed] = createSignal<string | null>(readDismissed())
  const [installing, setInstalling] = createSignal(false)
  let dispose: (() => void) | null = null

  onMount(() => {
    void window.api.updater.subscribe((next: UpdaterState) => setState(next)).then((stop) => {
      dispose = stop
    })
  })
  onCleanup(() => {
    dispose?.()
    dispose = null
  })

  const model = createMemo(() => updaterBannerModel(state()))
  const readyVersion = () => {
    const current = state()
    return current.status === "ready" ? current.version : null
  }
  const visible = createMemo(() => {
    const version = readyVersion()
    return model().visible && version !== null && dismissed() !== version
  })

  const dismiss = () => {
    const version = readyVersion()
    if (!version) return
    setDismissed(version)
    try {
      localStorage.setItem(DISMISS_KEY, version)
    } catch {
      // Non-persistent dismissal is still better than blocking the action.
    }
  }

  const install = async () => {
    if (installing()) return
    setInstalling(true)
    try {
      await window.api.updater.install()
    } catch (err) {
      showToastV2({
        description: `更新安装失败：${String((err as any)?.message ?? err)}`,
        duration: 4000,
      })
      setInstalling(false)
    }
  }

  return (
    <Show when={visible()}>
      <section class="mafw-updater-banner" role="status" aria-live="polite">
        <div class="mafw-updater-copy">
          <strong>{model().title}</strong>
          <span>{model().detail}</span>
        </div>
        <div class="mafw-updater-actions">
          <Show when={model().action === "install"}>
            <ButtonV2
              variant="contrast"
              size="small"
              disabled={installing()}
              onClick={() => void install()}
            >
              {installing() ? "正在重启…" : "重启以更新"}
            </ButtonV2>
          </Show>
          <ButtonV2 variant="ghost" size="small" onClick={dismiss}>
            稍后
          </ButtonV2>
        </div>
      </section>
    </Show>
  )
}
