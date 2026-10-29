import { Show, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { closeImageLightbox, imageLightboxUrl } from "../image-lightbox"

/** Fixed overlay; Esc/backdrop closes. Mounted once by MafwShell. */
export function ImageLightbox() {
  createEffect(() => {
    if (!imageLightboxUrl()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeImageLightbox()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={imageLightboxUrl()}>
      {(src) => (
        <Portal>
          <div
            class="mafw-image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="图片预览"
            onClick={closeImageLightbox}
          >
            <img src={src()} alt="图片预览" onClick={(event: MouseEvent) => event.stopPropagation()} />
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-image-lightbox-close"
              aria-label="关闭图片预览"
              onClick={(event: MouseEvent) => { event.stopPropagation(); closeImageLightbox() }}
            >
              <Icon name="close" size="small" />
            </ButtonV2>
          </div>
        </Portal>
      )}
    </Show>
  )
}
