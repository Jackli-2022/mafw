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

/** The last definition wins in CSS; several legacy blocks are duplicated. */
function lastBlock(selector: string): string {
  const needle = "\n" + selector
  let last = ""
  let from = 0
  while (true) {
    const i = css.indexOf(needle, from)
    if (i === -1) return last
    const open = css.indexOf("{", i)
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++
      if (css[j] === "}") depth--
      j++
    }
    last = css.slice(open + 1, j - 1)
    from = j
  }
}

describe("precision instrument direction", () => {
  test("inactive session tabs recede and hide identity dots", () => {
    const tab = lastBlock(".mafw-session-tab {")
    expect(tab).toContain("color: var(--text-3)")
    expect(lastBlock(".mafw-session-tab:not(.active) .mafw-agent-dot {")).toContain("display: none")
  })

  test("active tab uses a quiet raised surface and accent underline", () => {
    const active = lastBlock(".mafw-session-tab.active {")
    expect(active).toContain("background: var(--bg-raised)")
    expect(active).toContain("box-shadow: inset 0 -2px 0 var(--accent)")
    expect(active).not.toContain("var(--bg-overlay)")
  })

  test("goal sections are separated by space, not nested cards", () => {
    const section = lastBlock(".mafw-goal-section {")
    expect(section).not.toMatch(/border:\s*1px solid/)
    expect(section).toContain("border-top: 1px solid var(--border-subtle)")

    const technical = lastBlock(".mafw-goal-technical {")
    expect(technical).not.toMatch(/border:\s*1px solid/)
    expect(technical).not.toContain("background: var(--bg-inset)")
  })

  test("failure is a neutral surface with a danger rule", () => {
    const failure = lastBlock(".mafw-pod-result-failure {")
    expect(failure).toContain("border-left: 2px solid var(--danger)")
    expect(failure).not.toContain("color-mix")
    expect(failure).not.toContain("border-radius: var")
  })

  test("worktree rows use dividers instead of a nested card", () => {
    const worktree = lastBlock(".mafw-pod-result-worktree {")
    expect(worktree).not.toMatch(/border:\s*1px solid/)
    expect(worktree).not.toContain("background: var(--bg-inset)")

    const condition = lastBlock(".mafw-pod-result-condition {")
    expect(condition).not.toMatch(/border:\s*1px solid/)
    expect(condition).not.toContain("background: var(--bg-inset)")
  })

  test("Goal inline detail keeps horizontal breathing room in the right dock", () => {
    const inline = lastBlock(".mafw-goal-inline {")
    const padding = inline.match(/padding:\s*([^;]+);/)?.[1]?.trim().split(/\s+/)
    expect(padding).toBeTruthy()
    const left = padding!.length >= 4 ? padding![3] : padding![1] ?? padding![0]
    expect(parseFloat(left)).toBeGreaterThanOrEqual(16)
  })

  test("Goal inline detail does not replay an entrance on every data refresh", () => {
    const inline = lastBlock(".mafw-goal-inline {")
    expect(inline).not.toContain("animation:")
  })
})
