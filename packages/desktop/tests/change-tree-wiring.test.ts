import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("live changes tree wiring", () => {
  test("ChangesFace builds the shared change tree", () => {
    const face = read("src/renderer/mafw/components/ChangesFace.tsx")
    expect(face).toContain("buildChangeTree")
    expect(face).toContain("changeStatusLetter")
    expect(face).toContain("nextPulseState")
    expect(face).toContain("collapsed")
    expect(face).toContain("mafw-change-dir")
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
