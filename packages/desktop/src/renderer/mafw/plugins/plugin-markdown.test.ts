// Task 8 fix regression: the `markdown` Widget must not smuggle executable
// links or bypass the image policy. Raw HTML is escaped before parsing, a
// scoped marked renderer enforces the Widget link/image policy, and the result
// goes through session-ui `sanitizeMarkdown` in production.
import { describe, expect, test } from "bun:test"
import { renderPluginMarkdown, renderPluginMarkdownHtml } from "./plugin-markdown"

describe("plugin markdown policy", () => {
  test("javascript: links are rendered as plain text", () => {
    const html = renderPluginMarkdownHtml("[click me](javascript:alert(1))")
    expect(html).not.toMatch(/href\s*=\s*["']javascript:/i)
    expect(html).not.toMatch(/<a\b/i)
    expect(html).toContain("click me")
  })

  test("remote images are not rendered as images", () => {
    const html = renderPluginMarkdownHtml("![tracker](https://evil.example/tracker.png)")
    expect(html).not.toMatch(/<img\b/i)
    expect(html).toContain("tracker")
  })

  test("safe links keep their href and rel", () => {
    const html = renderPluginMarkdownHtml("[docs](https://example.com/docs) and [mail](mailto:dev@example.com)")
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('href="mailto:dev@example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test("only data:image sources survive as images", () => {
    const html = renderPluginMarkdownHtml("![chart](data:image/png;base64,AAAA)")
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('alt="chart"')
  })

  test("raw HTML never becomes markup", () => {
    const html = renderPluginMarkdownHtml('<img src=x onerror="alert(1)">')
    expect(html).not.toMatch(/<img\b/i)
    // The source survives only as escaped text.
    expect(html).toContain("&lt;img")
    expect(html).toContain("&quot;")
  })

  test("production path passes policy-filtered HTML to the sanitizer", () => {
    let seen = ""
    const output = renderPluginMarkdown(
      "[bad](javascript:alert(1)) ![bad](https://evil.example/x.png) [ok](https://example.com)",
      (html) => {
        seen = html
        return "SANITIZED"
      },
    )
    expect(output).toBe("SANITIZED")
    expect(seen).not.toMatch(/href\s*=\s*["']javascript:/i)
    expect(seen).not.toMatch(/<img\b/i)
    expect(seen).toContain('href="https://example.com"')
  })
})
