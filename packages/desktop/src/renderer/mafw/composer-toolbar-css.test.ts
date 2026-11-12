import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 2026-11-09 定稿：常态只放 6 件（＋ / 上下文环 / 权限图标 / 模型 pill / 🎤 / 发送），
// 在 chat 320px（composer 256px）下全部可见 —— 因此不再允许容器查询隐藏任何控件。
const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")
const pane = readFileSync(join(import.meta.dirname, "components", "ChatPane.tsx"), "utf8")

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? ""
}

describe("composer toolbar layout contract", () => {
  test("no control is ever hidden by a width rule (zero-degrade at 256px)", () => {
    // 任何 composer 控件都不允许出现 display:none（无论挂在哪个 @container 下）
    expect(css).not.toMatch(/\.mafw-(?:composer-(?:attach|icon|session-pill)|context-ring|perm-icon|model-name|send)[^{,]*\{[^}]*display:\s*none/)
    expect(css).not.toContain(".mafw-context-pill")
    expect(css).not.toContain(".mafw-composer-meta")
    expect(css).not.toContain(".mafw-mode-pill")
  })

  test("compact toolbar: 40px bar with 26px icon buttons", () => {
    expect(rule(".mafw-composer-toolbar")).toContain("height: 40px")
    const icon = rule('.mafw-composer [data-component="button-v2"].mafw-composer-icon')
    expect(icon).toContain("width: 26px")
    expect(icon).toContain("height: 26px")
  })

  test("model pill is the only shrinkable item; send and icons never shrink", () => {
    expect(rule(".mafw-composer-right")).toContain("min-width: 0")
    expect(rule('.mafw-composer [data-component="button-v2"].mafw-send')).toContain("flex: none")
    expect(rule(".mafw-composer [data-component=\"button-v2\"].mafw-composer-icon")).toContain("flex: none")
    expect(rule(".mafw-composer-session-pill, .mafw-composer .mafw-model-pill")).toContain("min-width: 0")
  })

  test("permission icon tones use muted / accent / danger tokens", () => {
    expect(rule(".mafw-perm-icon.is-muted")).toContain("var(--text-4)")
    expect(rule(".mafw-perm-icon.is-accent")).toContain("var(--accent)")
    expect(rule(".mafw-perm-icon.is-danger")).toContain("var(--danger-text)")
  })

  test("context ring turns warning at 70% and danger at 90%", () => {
    expect(rule(".mafw-context-ring.is-warn")).toContain("var(--warning-text)")
    expect(rule(".mafw-context-ring.is-danger")).toContain("var(--danger-text)")
    expect(rule('.mafw-context-ring [data-slot="progress-circle-v2-progress"]')).toContain("currentColor")
  })

  test("the only narrow-tier degradation is the deviation badge (controls never hide)", () => {
    const tier = css.match(/@container \(max-width: 360px\) \{([^}]*)\}/)?.[1] ?? ""
    expect(tier).toContain(".mafw-composer-session-badge")
    expect(tier).toContain("display: none")
    for (const control of ["mafw-composer-attach", "mafw-context-ring", "mafw-perm-icon", "mafw-model-name", "mafw-send"]) {
      expect(tier).not.toContain(control)
    }
  })

  test("tooltip wrappers are flex items too: only the model pill wrapper may shrink", () => {
    // 2026-11-09 CDP 实测：按钮外面还有一层 tooltip-v2-trigger（真正的 flex item），
    // 它的 min-width:auto 会把模型 pill 顶出容器（256px 时溢出约 200px）。
    expect(rule('.mafw-composer-right > [data-component="tooltip-v2-trigger"]')).toContain("flex: none")
    expect(rule('.mafw-composer-right > [data-component="tooltip-v2-trigger"]:has(.mafw-model-pill)')).toContain("flex: 0 1 auto")
  })

  test("session config menu scrolls its rows instead of clipping the Thinking submenu", () => {
    // 2026-11-06 实证：.mafw-picker-pop 是 overflow:hidden + max-height:380，
    // Thinking 展开 8 档后下半截被裁掉，点不到。菜单必须可滚动且高度随视口收缩。
    const menu = css.match(/\.mafw-config-menu \{[^}]*\}/)?.[0] ?? ""
    expect(menu).toContain("max-height: min(480px, calc(100vh - 16px))")
    const rows = css.match(/\.mafw-config-menu \.mafw-config-rows \{[^}]*\}/)?.[0] ?? ""
    expect(rows).toContain("overflow-y: auto")
    expect(rows).toContain("min-height: 0")
  })
})

describe("composer control inventory", () => {
  test("the removed controls are gone from the JSX", () => {
    expect(pane).not.toContain("mafw-composer-more")
    expect(pane).not.toContain("mafw-mode-pill")
    expect(pane).not.toContain("mafw-context-pill")
    expect(pane).not.toContain("formatComposerMeta")
  })

  test("the six surviving controls are all present", () => {
    expect(pane).toContain("mafw-composer-attach")
    expect(pane).toContain("mafw-context-ring")
    expect(pane).toContain("mafw-perm-icon")
    expect(pane).toContain("mafw-composer-session-pill")
    expect(pane).toContain("handleMicClick")
    expect(pane).toContain("mafw-send")
  })

  test("permission icon lives in the left group, right after ＋ (2026-11-09)", () => {
    const left = pane.indexOf('class="mafw-composer-left"')
    const right = pane.indexOf('class="mafw-composer-right"')
    const perm = pane.indexOf('class="mafw-perm-icon"')
    expect(left).toBeGreaterThan(-1)
    expect(perm).toBeGreaterThan(left)
    expect(perm).toBeLessThan(right)
  })
})
