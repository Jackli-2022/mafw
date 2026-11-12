import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

function block(selector: string): string {
  const i = css.indexOf(selector)
  if (i === -1) return ""
  const open = css.indexOf("{", i)
  let depth = 1
  let j = open + 1
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++
    if (css[j] === "}") depth--
    j++
  }
  return css.slice(open + 1, j - 1)
}

function token(b: string, name: string): string {
  return b.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim() ?? ""
}

function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((x) => parseInt(x, 16) / 255)
  if (!channels || channels.length !== 3) return Number.NaN
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const dark = block(".mafw-shell, body {")
const light = block('html[data-theme="light"] .mafw-shell,')
const sysLight = block("html:not([data-theme]) .mafw-shell,")
const themes = [
  ["dark", dark],
  ["light", light],
  ["sysLight", sysLight],
] as const

describe("visual language tokens", () => {
  test("all themes define action, border and radius semantics", () => {
    for (const [, b] of themes) {
      for (const key of [
        "--action-primary-bg",
        "--action-primary-fg",
        "--action-primary-bg-hover",
        "--action-primary-bg-active",
        "--border",
        "--border-strong",
        "--success",
        "--success-soft",
      ]) {
        expect(token(b, key)).not.toBe("")
      }
      expect(token(b, "--hairline")).toBe("1px")
    }
  })

  test("approved dark palette", () => {
    expect(token(dark, "--bg-base")).toBe("#111315")
    expect(token(dark, "--accent")).toBe("#9DB4FF")
    expect(token(dark, "--action-primary-bg")).toBe("#E8EAEC")
    expect(token(dark, "--success")).toBe("#6FC79B")
  })

  test("approved light palette", () => {
    expect(token(light, "--bg-base")).toBe("#F6F7F8")
    expect(token(light, "--accent")).toBe("#2B54D8")
    expect(token(light, "--action-primary-bg")).toBe("#202226")
    expect(token(light, "--success")).toBe("#247A4D")
    expect(token(sysLight, "--bg-base")).toBe(token(light, "--bg-base"))
  })

  test("text contrast passes on every surface", () => {
    for (const [, b] of themes) {
      const surfaces = ["--bg-base", "--bg-inset", "--bg-raised", "--bg-overlay", "--bg-float"].map((k) =>
        token(b, k),
      )
      for (const text of ["--text-3", "--text-4", "--text-5"].map((k) => token(b, k))) {
        for (const surface of surfaces) expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("focus and control boundary meet 3:1", () => {
    for (const [, b] of themes) {
      expect(contrast(token(b, "--accent"), token(b, "--bg-base"))).toBeGreaterThanOrEqual(3)
      expect(contrast(token(b, "--border-strong"), token(b, "--bg-raised"))).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("visual surfaces", () => {
  test("no subpixel borders or ring shadows remain", () => {
    expect(css).not.toMatch(/(?:border(?:-[a-z]+)?|outline(?:-[a-z]+)?)\s*:[^;{}]*0\.5px/)
    expect(css).not.toMatch(/box-shadow:[^;{}]*0 0 0 (?:0\.5px|\.5px)/)
  })

  test("composer uses one focus ring and 12px radius", () => {
    const base = block(".mafw-composer {")
    const focus = block(".mafw-composer:focus-within")
    expect(token(base, "border-radius")).toBe("var(--r-xl)")
    expect(focus).toContain("box-shadow: 0 0 0 2px")
    expect(focus).not.toContain("4px")
  })

  test("core content cards have no decorative gradient or inset highlight", () => {
    expect(block(".mafw-card {")).not.toContain("inset 0 1px 0")
    expect(block(".mafw-usage-model-bar-fill {")).not.toContain("linear-gradient")
  })
})

describe("semantic color roles", () => {
  test("desktop contrast buttons use action tokens without gradient", () => {
    const b = block('.mafw-shell [data-component="button-v2"][data-variant="contrast"] {')
    expect(b).toContain("background: var(--action-primary-bg)")
    expect(b).toContain("color: var(--action-primary-fg)")
    expect(b).not.toContain("linear-gradient")
    expect(b).not.toMatch(/text-shadow:\s*0/)
  })

  test("send and success semantics are distinct", () => {
    expect(block('.mafw-composer [data-component="button-v2"].mafw-send {')).toContain(
      "background: var(--action-primary-bg)",
    )
    expect(block(".mafw-phase-badge-ok {")).toContain("background: var(--success-soft)")
    expect(css).not.toMatch(/(?:color|background|border-color):\s*var\(--accent-success/)
  })

  test("desktop maps every v2 state surface to MAFW semantics", () => {
    for (const [, b] of themes) {
      for (const key of [
        "--v2-background-bg-contrast",
        "--v2-text-text-contrast",
        "--v2-border-border-base",
        "--v2-border-border-focus",
        "--v2-state-fg-success",
        "--v2-state-fg-danger",
        "--v2-icon-icon-base",
        "--v2-icon-icon-muted",
      ]) {
        expect(token(b, key)).not.toBe("")
      }
    }
  })
})

const CORE_META = [
  ".mafw-data-part-badge {",
  ".mafw-data-part-name {",
  ".mafw-card-meta {",
  ".mafw-tool-meta-label {",
  ".mafw-execute-count {",
  ".mafw-work-chip {",
  ".mafw-work-filter-count {",
  ".mafw-rw-overview-meta {",
  ".mafw-rw-overview-label {",
]

describe("readable metadata and session icons", () => {
  test("core metadata is at least 12px", () => {
    for (const selector of CORE_META) {
      const b = block(selector)
      expect(b).not.toBe("")
      expect(b).not.toMatch(/font-size:\s*(?:9|9\.5|10|10\.5|11|11\.5)px/)
    }
  })

  test("session chrome uses registered icons", () => {
    const src = readFileSync(join(import.meta.dirname, "components", "SessionStrip.tsx"), "utf8")
    expect(src).not.toContain(">✕<")
    expect(src).not.toContain(">+<")
    expect(src).toContain('icon="close"')
    expect(src).toContain('icon="plus"')
  })

  test("session-ui metadata is at least 12px", () => {
    const files = [
      "../../../../session-ui/src/v2/components/attachment-card-v2.css",
      "../../../../session-ui/src/v2/components/session-review-v2.css",
      "../../../../session-ui/src/v2/components/basic-tool-v2.css",
      "../../../../session-ui/src/v2/components/tool-error-card-v2.css",
      "../../../../session-ui/src/components/markdown.css",
    ]
    for (const file of files) {
      expect(readFileSync(join(import.meta.dirname, file), "utf8")).not.toMatch(
        /font-size:\s*(?:9|9\.5|10|10\.5|11|11\.5)px/,
      )
    }
  })
})
