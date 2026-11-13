import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("live changes tree wiring", () => {
  test("the left changes face is Goal-first and keeps live diff counts", () => {
    const face = read("src/renderer/mafw/components/ChangesFace.tsx")
    expect(face).toContain("buildGoalGroups")
    expect(face).toContain("buildDiscussionGroups")
    expect(face).toContain("collapsedGoals")
    expect(face).toContain("mafw-changes-group")
  })

  test("the change-set tab renders file status and the toolbar dropdown", () => {
    const view = read("src/renderer/mafw/components/ChangeSetView.tsx")
    expect(view).toContain("changeStatusLetter")
    expect(view).toContain("mafw-changeset-menu")
  })

  test("MafwShell passes the live session_diff snapshot (undefined before first event)", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("liveDiffs={store.session_diff")
  })

  test("pulse CSS exists and honors reduced motion", () => {
    const css = read("src/renderer/mafw/mafw.css")
    expect(css).toContain(".mafw-change-pulse")
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*mafw-change-pulse/)
  })
})
