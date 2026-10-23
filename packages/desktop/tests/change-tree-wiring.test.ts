import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("live changes tree wiring", () => {
  test("ChangesDock builds a tree and pulses live diffs with a per-session baseline", () => {
    const dock = read("src/renderer/mafw/components/ChangesDock.tsx")
    expect(dock).toContain("buildChangeTree")
    expect(dock).toContain("changedDiffPaths")
    expect(dock).toContain("liveDiffs")
    expect(dock).toContain("prevLive")
    expect(dock).toContain("mafw-change-pulse")
    expect(dock).toContain("mafw-change-dir")
    expect(dock).toContain("changeStatusLetter")
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
