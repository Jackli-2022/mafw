// Composer 附件管线 hook（逐字迁移自 ChatPane.tsx 616-816，闭包改 hook 内状态）。
// 纯函数 fitWithin / mimeOf 可独立单测；canvas/FileReader/window.api 留在 hook 内。
import { createSignal } from "solid-js"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"

export type Attachment = {
  token?: string
  path?: string
  name: string
  size: number
  mime?: string
  dataUrl?: string
}

/** 等比缩到 maxDim 内（单边超限时），未超限原样返回。 */
export function fitWithin(width: number, height: number, maxDim: number): [number, number] {
  if (width <= maxDim && height <= maxDim) return [width, height]
  const scale = Math.min(maxDim / width, maxDim / height)
  return [Math.round(width * scale), Math.round(height * scale)]
}

const MIME_MAP: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", json: "application/json", js: "text/plain", ts: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogg: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg",
  pdf: "application/pdf", csv: "text/csv", yaml: "text/plain", yml: "text/plain", py: "text/plain",
}

/** 按文件名扩展名映射 mime（未知回落 application/octet-stream）。 */
export function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || ""
  return MIME_MAP[ext] || "application/octet-stream"
}

export function useAttachments() {
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [dragging, setDragging] = createSignal(false)

  const addAttachments = async () => {
    try {
      const picked: any = await (window as any).api?.openFilePicker?.({ multiple: true })
      if (!picked?.files?.length) return
      setAttachments(prev => [...prev, ...picked.files.map((f: any) => ({ token: picked.token, path: f.path, name: f.name, size: f.size, mime: f.type || undefined }))])
    } catch (e) {
      console.warn("[mafw] openFilePicker error:", e)
    }
  }

  const removeAttachment = (idx: number) => {
    const att = attachments()[idx]
    const rest = attachments().filter((_, i) => i !== idx)
    setAttachments(prev => prev.filter((_, i) => i !== idx))
    // Multiple picker files share one token; only release when no other
    // attachment still needs it.
    if (att?.token && !rest.some(a => a.token === att.token)) {
      (window as any).api?.releasePickedFiles?.(att.token)
    }
  }

  // Electron 42 removed File.path — resolve via webUtils through preload.
  const pathOfFile = (file: File): string | undefined => {
    try {
      return (window as any).api?.getPathForFile?.(file) as string | undefined
    } catch { return undefined }
  }

  // Client-side downscale for pasted images: the opencode server's
  // image.normalize caps at 2000px / ~5MB base64 and throws (uncaught) when a
  // paste exceeds it — flatten to canvas first to keep sends reliable.
  const imageToDataUrl = async (file: File): Promise<string | undefined> => {
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("image decode failed"))
        img.src = raw
      })
      const MAX = 2000
      const [width, height] = fitWithin(img.width, img.height, MAX)
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) return raw
      ctx.drawImage(img, 0, 0, width, height)
      const quality = raw.length > 4 * 1024 * 1024 ? 0.7 : 0.85
      return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", quality)
    } catch (e) {
      console.warn("[mafw] imageToDataUrl error:", e)
      return undefined
    }
  }

  const rawFileToDataUrl = async (file: File): Promise<string | undefined> => {
    try {
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
    } catch (e) {
      console.warn("[mafw] rawFileToDataUrl error:", e)
      return undefined
    }
  }

  const addPastedFile = async (file: File) => {
    if (!file) return
    if (file.type.startsWith("image/")) {
      const dataUrl = await imageToDataUrl(file)
      if (!dataUrl) return
      setAttachments(prev => [...prev, { name: file.name || "粘贴图片.png", size: file.size, mime: file.type, dataUrl }])
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      // Video/audio: no canvas pipeline — read the file straight to a data URL.
      const dataUrl = await rawFileToDataUrl(file)
      if (!dataUrl) return
      setAttachments(prev => [...prev, { name: file.name, size: file.size, mime: file.type, dataUrl }])
    } else {
      const path = pathOfFile(file)
      if (path) {
        setAttachments(prev => [...prev, { path, name: file.name, size: file.size, mime: file.type || undefined }])
      }
    }
  }

  // ── Paste (Ctrl+V / right-click / Shift+Insert all fire onPaste) ──
  const handlePaste = async (e: ClipboardEvent) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = Array.from(cd.items || []).flatMap(item => {
      if (item.kind !== "file") return []
      const f = item.getAsFile()
      return f ? [f] : []
    })
    if (files.length > 0) {
      e.preventDefault()
      for (const f of files) await addPastedFile(f)
      return
    }
    const plainText = cd.getData("text/plain") ?? ""
    // Browser clipboard has no file items and no text — try system clipboard image.
    if (!plainText) {
      try {
        const img: any = await (window as any).api?.readClipboardImage?.()
        if (img?.buffer) {
          e.preventDefault()
          const file = new File([img.buffer], "剪贴板图片.png", { type: "image/png" })
          await addPastedFile(file)
        }
      } catch (err) {
        console.warn("[mafw] readClipboardImage error:", err)
      }
    }
    // Pure text: no preventDefault — native paste proceeds.
  }

  // ── Drag & drop onto the composer ──
  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault()
      setDragging(true)
    }
  }
  const handleDragLeave = (e: DragEvent) => {
    if (!(e.currentTarget as HTMLElement | null)?.contains(e.relatedTarget as Node)) setDragging(false)
  }
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dt = e.dataTransfer
    if (!dt) return
    const plainText = dt.getData("text/plain")
    if (plainText?.startsWith("file:")) {
      const p = plainText.slice(5)
      if (p) setAttachments(prev => [...prev, { path: p, name: p.split(/[\\/]/).pop() || p, size: 0 }])
      return
    }
    const dropped = dt.files
    if (dropped?.length) {
      for (const f of Array.from(dropped)) await addPastedFile(f)
    }
  }

  // Upload raw media bytes to the gateway's A2A artifact store. Routed through
  // the main process (IPC → Node network stack): the renderer's own fetch can
  // hang on proxy interception. 15s main-side timeout, then the caller falls
  // back to the IPC dataUrl path.
  const uploadMediaBinary = async (bytes: ArrayBuffer, mediaType: string): Promise<string> => {
    const artifactId = await window.api.mafw.media.uploadBinary(bytes, mediaType)
    return artifactId
  }

  return {
    attachments,
    setAttachments,
    dragging,
    setDragging,
    addAttachments,
    removeAttachment,
    addPastedFile,
    imageToDataUrl,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    uploadMediaBinary,
  }
}
