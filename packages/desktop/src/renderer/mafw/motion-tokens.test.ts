import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

/** 取 .mafw-shell 基础块（第一个不带 html[] 前缀的 .mafw-shell 规则）到 --font-ui 结束。 */
const shellBlock = css.slice(css.indexOf(".mafw-shell, body {"), css.indexOf("/* 亮色：手动覆盖"))

describe("visual language motion tokens", () => {
  test("approved motion tokens exist with the agreed values", () => {
    expect(shellBlock).toMatch(/--dur-press:\s*80ms/)
    expect(shellBlock).toMatch(/--dur-fast:\s*120ms/)
    expect(shellBlock).toMatch(/--dur-select:\s*180ms/)
    expect(shellBlock).toMatch(/--dur-enter:\s*220ms/)
    expect(shellBlock).toMatch(/--dur-surface:\s*240ms/)
    expect(shellBlock).toMatch(/--dur-progress:\s*320ms/)
    expect(shellBlock).toMatch(/--dur-exit:\s*140ms/)
    expect(shellBlock).toMatch(/--dur-morph:\s*340ms/)
    expect(shellBlock).toMatch(/--ease-standard:\s*cubic-bezier\(\.2,\s*\.8,\s*\.2,\s*1\)/)
    expect(shellBlock).toMatch(/--ease-surface:\s*cubic-bezier\(\.16,1,\.3,1\)/)
    expect(shellBlock).toMatch(/--ease-exit:\s*cubic-bezier\(\.4,0,1,1\)/)
  })

  test("legacy duration aliases resolve to the approved semantic scale", () => {
    expect(shellBlock).toMatch(/--dur-1:\s*var\(--dur-fast\)/)
    expect(shellBlock).toMatch(/--dur-2:\s*var\(--dur-select\)/)
    expect(shellBlock).toMatch(/--dur-3:\s*var\(--dur-select\)/)
    expect(shellBlock).toMatch(/--dur-4:\s*var\(--dur-surface\)/)
    expect(shellBlock).toMatch(/--ease:\s*cubic-bezier\(\.25,0,0,1\)/)
  })

  test("new semantic durations have real consumers", () => {
    expect(css).toContain("var(--dur-enter)")
    expect(css).toContain("var(--dur-press)")
    expect(css).toContain("var(--dur-select)")
    expect(css).toContain("var(--dur-progress)")
    expect(css).toContain("var(--dur-exit)")
  })

  test("command palette uses enter and exit choreography", () => {
    expect(css).toMatch(/\.mafw-palette-backdrop\s*\{[^}]*mafw-backdrop-in/)
    expect(css).toMatch(/\.mafw-palette-backdrop\.closing\s*\{[^}]*var\(--dur-exit\)/)
    expect(css).toMatch(/\.mafw-palette\s*\{[^}]*mafw-palette-in/)
    expect(css).toMatch(/\.mafw-palette-backdrop\.closing \.mafw-palette\s*\{[^}]*var\(--dur-exit\)/)
  })
})

describe("rail column width transition", () => {
  test("shell drives the rail column with an animatable var", () => {
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*grid-template-columns:\s*var\(--rail-w/)
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
  test("rail column clips overflow so content never reflows mid-animation", () => {
    expect(css).toMatch(/\.mafw-rail-col\s*\{[^}]*overflow:\s*hidden/)
  })
})

describe("dock column width transition", () => {
  test("body animates its grid columns", () => {
    expect(css).toMatch(/\.mafw-body\s*\{[^}]*transition:\s*grid-template-columns\s+var\(--dur-surface\)\s+var\(--ease-surface\)/)
  })
})

describe("surface-tier entrances use surface tokens", () => {
  test("content first-paint uses enter tier and dock uses surface tier", () => {
    expect(css).toMatch(/\.mafw-content:not\(\.mafw-chat-content\)\s*>\s*\*\s*\{[^}]*var\(--dur-enter\)/)
    expect(css).toMatch(/mafw-dock-in var\(--dur-surface\) var\(--ease-surface\)/)
  })
})

describe("micro-interaction press feedback", () => {
  test("primary self-drawn controls define a press state", () => {
    expect(css).toMatch(/\.mafw-rail-session:active/)
    expect(css).toMatch(/\.mafw-session-tab:active\s*\{/)
    expect(css).toMatch(/\.mafw-changes-row:active/)
  })
})

describe("turn enter gating", () => {
  test("enter animation is class-scoped (no blanket rule => no history cascade)", () => {
    expect(css).toMatch(/\.mafw-turn-animate\s*\{[^}]*mafw-enter/)
    expect(css).not.toMatch(/\.mafw-session-turn-container \[data-component="session-turn"\]\s*\{[^}]*mafw-enter/)
  })
})

describe("streaming caret", () => {
  test("uses the standard easing token", () => {
    expect(css).toMatch(/mafw-caret-blink 1s var\(--ease-standard\)/)
  })
})

describe("v7 closing (tier discipline)", () => {
  test("drawer entrance uses surface tier", () => {
    expect(css).toMatch(/mafw-drawer-in var\(--dur-surface\) var\(--ease-surface\)/)
  })
})
