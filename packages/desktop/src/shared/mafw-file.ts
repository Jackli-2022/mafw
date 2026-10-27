// mafw-file:// 协议共享逻辑（main 注册 handler 与 renderer 拼 URL 共用，spec 2026-10-27-workbench-file-preview §3）。
// URL 形态：mafw-file://<rootToken 十六进制>/<逐段编码的相对路径>[?v=<mtime>]
export const MAFW_FILE_SCHEME = "mafw-file"

const TOKEN_RE = /^[a-f0-9]{8,64}$/

function encodeRel(rel: string): string {
  return rel
    .split(/[\\/]+/)
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/")
}

export function buildMafwFileUrl(token: string, rel: string, version?: number | string): string {
  if (!TOKEN_RE.test(token)) throw new Error(`bad mafw-file token: ${token}`)
  const path = encodeRel(rel)
  if (!path) throw new Error("empty mafw-file path")
  const suffix = version === undefined ? "" : `?v=${encodeURIComponent(String(version))}`
  return `${MAFW_FILE_SCHEME}://${token}/${path}${suffix}`
}

export type ParsedMafwFile = { token: string; rel: string }

/** 解析 + 安全闸：非本 scheme / 坏 URL / 未知形态 / traversal / 绝对路径一律 null（调用方 404）。
 *  注意不能只靠 `new URL()`：URL 构造器会把 `%2e%2e` 与 `..` 预规范化掉，逃逸痕迹丢失——
 *  先对原始串做段级检查（解码前后各一次），再取 token/rel。 */
export function parseMafwFileUrl(raw: string): ParsedMafwFile | null {
  const prefix = `${MAFW_FILE_SCHEME}://`
  if (!raw.toLowerCase().startsWith(prefix)) return null
  const rest = raw.slice(prefix.length).split(/[?#]/)[0]
  const slash = rest.indexOf("/")
  if (slash <= 0) return null
  const token = rest.slice(0, slash).toLowerCase()
  if (!TOKEN_RE.test(token)) return null

  const rawPath = rest.slice(slash)
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  // 只生产 `/` 分隔；出现反斜杠即视为走私（Windows 路径分隔符变体）。
  if (decoded.includes("\\")) return null
  const segs = decoded.split("/").slice(1)
  if (segs.length === 0) return null
  for (const seg of segs) {
    if (seg.length === 0 || seg === "." || seg === "..") return null
    // `:` 挡驱动器号（C:/…）与协议混淆；解码后出现 `/` 不可能（已 split），保留检查防御未来改动
    if (seg.includes(":") || seg.includes("/")) return null
  }
  return { token, rel: segs.join("/") }
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

export function mimeForPath(rel: string): string {
  const base = rel.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return "application/octet-stream"
  return MIME[base.slice(dot + 1).toLowerCase()] ?? "application/octet-stream"
}

/** 地址栏友好显示：mafw-file URL → 解码后的相对路径；其他/null → null。 */
export function displayMafwFilePath(raw: string): string | null {
  const parsed = parseMafwFileUrl(raw)
  return parsed ? parsed.rel : null
}
