// Task 8 fix: safe markdown rendering for plugin views.
//
// Raw HTML is escaped before parsing, then a package-scoped marked renderer
// enforces the same link/image policy as the other Widgets (`http(s)`/`mailto`/
// `tel` links, `data:image/*` only). The resulting HTML is finally passed
// through session-ui's DOMPurify `sanitizeMarkdown` as defense in depth.
import { Marked, type RendererObject } from "marked"
import { sanitizeMarkdown } from "@mafw/session-ui/markdown-cache"
import { safePluginImageDataUrl, safePluginLinkHref } from "./plugin-view-model"

/** Same policy as the `link`/`image` Widgets, applied to markdown syntax. */
const pluginRenderer: RendererObject = {
  link(token) {
    const label = this.parser.parseInline(token.tokens)
    const href = safePluginLinkHref(token.href)
    if (!href) return `<span>${label}</span>`
    return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  },
  image(token) {
    const alt = escapeAttribute(token.text || "")
    const src = safePluginImageDataUrl(token.href)
    if (!src) return `<span>${alt}</span>`
    return `<img src="${escapeAttribute(src)}" alt="${alt}" />`
  },
}

const pluginMarkdown = new Marked({ gfm: true })
pluginMarkdown.use({ renderer: pluginRenderer })

/** Markdown → policy-filtered HTML, before the DOMPurify pass. */
export function renderPluginMarkdownHtml(text: string): string {
  return pluginMarkdown.parse(escapeRawHtml(text)) as string
}

/**
 * Markdown → sanitized HTML for the `markdown` Widget.
 *
 * `sanitize` is injectable so the policy can be verified headlessly (DOMPurify
 * itself needs a DOM); production always uses session-ui `sanitizeMarkdown`.
 */
export function renderPluginMarkdown(
  text: string,
  sanitize: (html: string) => string = sanitizeMarkdown,
): string {
  return sanitize(renderPluginMarkdownHtml(text))
}

function escapeRawHtml(text: string): string {
  return text.replace(
    /[&<>]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] as string,
  )
}

function escapeAttribute(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  )
}
