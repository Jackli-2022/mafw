// In-app lightbox for data:image links (python figures / plugin image widgets).
// Module-level so any card can open it without prop drilling through the shell.
import { createSignal } from "solid-js"

const [url, setUrl] = createSignal<string | null>(null)

export function openImageLightbox(raw: string): void {
  const value = raw.trim()
  if (!value.startsWith("data:image/")) return
  setUrl(value)
}

export function closeImageLightbox(): void {
  setUrl(null)
}

export function imageLightboxUrl(): string | null {
  return url()
}

export function resetImageLightboxForTests(): void {
  setUrl(null)
}
