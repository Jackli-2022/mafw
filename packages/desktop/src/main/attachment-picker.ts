import { randomUUID } from "node:crypto"
import { open } from "node:fs/promises"

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi", "flv", "wmv", "m4v", "mpg", "mpeg", "3gp", "ogv", "ts", "mts", "m2ts"])
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "flac", "ogg", "aac", "wma", "opus"])

export function mediaMaxForPath(p: string): number {
  const ext = p.split(".").pop()?.toLowerCase() || ""
  if (VIDEO_EXTS.has(ext)) return VIDEO_MAX_BYTES
  if (AUDIO_EXTS.has(ext)) return AUDIO_MAX_BYTES
  return IMAGE_MAX_BYTES
}

export function createPickedFileAuthorizations(
  read: (path: string, maxBytes: number) => Promise<ArrayBuffer> = readAttachment,
  budget = MAX_ATTACHMENT_BYTES,
) {
  const selections = new Map<string, { sender: number; paths: Set<string>; remaining: number }>()

  return {
    add(sender: number, paths: string[]) {
      const token = randomUUID()
      selections.set(token, { sender, paths: new Set(paths), remaining: budget })
      return token
    },
    async read(sender: number, token: string, path: string) {
      const selection = selections.get(token)
      if (selection?.sender !== sender || !selection.paths.delete(path))
        throw new Error("File was not selected by the picker")
      const bytes = await read(path, Math.min(selection.remaining, mediaMaxForPath(path)))
      selection.remaining -= bytes.byteLength
      if (selection.paths.size === 0) selections.delete(token)
      return bytes
    },
    release(sender: number, token: string) {
      if (selections.get(token)?.sender === sender) selections.delete(token)
    },
  }
}

export function assertAttachmentBudget(files: { size: number; name?: string; path?: string }[]) {
  for (const file of files) {
    const max = mediaMaxForPath(file.path || file.name || "")
    if (file.size > max)
      throw new Error(`Attachment exceeds the ${max / 1024 / 1024} MB limit`)
  }
}

export async function readAttachment(filePath: string, maxBytes = mediaMaxForPath(filePath)) {
  const file = await open(filePath, "r")
  try {
    const info = await file.stat()
    if (info.size > maxBytes)
      throw new Error(`Attachment exceeds the ${maxBytes / 1024 / 1024} MB limit`)
    const bytes = Buffer.allocUnsafe(info.size)
    let offset = 0
    while (offset < info.size) {
      const result = await file.read(bytes, offset, info.size - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + offset) as ArrayBuffer
  } finally {
    await file.close()
  }
}
