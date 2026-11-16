const INSTRUCTION_FILE_RE = /^(?:agents|claude)\.md$/i

/** Project docs and instruction files are the `@docs` source. */
export function isDocsPath(path: string): boolean {
  const rel = path.replace(/\\/g, "/").replace(/^\/+/, "")
  if (rel.startsWith("docs/")) return true
  if (/^readme\.md$/i.test(rel)) return true
  return INSTRUCTION_FILE_RE.test(rel.split("/").pop() ?? "")
}

/** Stable text block appended to the prompt for `@web` links. */
export function formatWebContext(links: readonly { url: string }[]): string {
  if (links.length === 0) return ""
  return `Web context:\n${links.map((link) => `- ${link.url}`).join("\n")}`
}

/** Normalize a user-entered URL; only http(s) survives. */
export function normalizeWebUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}
