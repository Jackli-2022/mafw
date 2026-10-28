const EXTERNAL = /^(https?:|mailto:|#|javascript:|data:|\/\/)/i

export function filePathFromHref(href: string): string | null {
  const raw = href.trim()
  if (!raw || EXTERNAL.test(raw)) return null

  const withoutQuery = raw.split("#")[0].split("?")[0]
  if (!withoutQuery) return null

  try {
    return decodeURI(withoutQuery)
  } catch {
    return withoutQuery
  }
}
