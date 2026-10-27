// 文件种类与点击分流（spec 2026-10-27-workbench-file-preview §2）。
// 图片 → 文件 surface 内只读预览 tab；svg 默认文本（预览为显式动作）；html → 浏览器 surface。
export type FileKind = "image" | "svg" | "html" | "text" | "pdf" | "table" | "markdown" | "json" | "xlsx" | "docx" | "pptx"

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"] as const

const IMAGE_SET = new Set<string>(IMAGE_EXTS)

function extOf(rel: string): string {
  const base = rel.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return "" // 无扩展名或点文件（.env）
  return base.slice(dot + 1).toLowerCase()
}

export function fileKindFor(rel: string): FileKind {
  const ext = extOf(rel)
  if (!ext) return "text"
  if (IMAGE_SET.has(ext)) return "image"
  if (ext === "svg") return "svg"
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "pdf") return "pdf"
  if (ext === "csv" || ext === "tsv") return "table"
  if (ext === "md" || ext === "markdown") return "markdown"
  if (ext === "json") return "json"
  if (ext === "xlsx") return "xlsx"
  if (ext === "docx") return "docx"
  if (ext === "pptx") return "pptx"
  return "text"
}

/** 点击分流：html/pdf 进浏览器 surface（单 webview 导航），其余全部进文件 surface。 */
export function fileOpenPlan(rel: string): "browser" | "editor" {
  const kind = fileKindFor(rel)
  return kind === "html" || kind === "pdf" ? "browser" : "editor"
}
