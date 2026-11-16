import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), "utf8")
const shell = read("MafwShell.tsx")
const files = read("components/FilesDock.tsx")
const left = read("components/LeftDock.tsx")
const css = read("mafw.css")

describe("file tree → preview shared element", () => {
  test("the clicked tree row is passed through to the file opener", () => {
    expect(files).toContain("onOpenFile(row.rel, source)")
    expect(files).toContain("event.currentTarget")
    expect(left).toContain("props.onOpenFile?.(rel, source)")
  })

  test("the shell wraps editor opens in a View Transition with a reduced-motion fallback", () => {
    expect(shell).toContain("startViewTransition")
    expect(shell).toContain("mafw-file-morph")
    expect(shell).toContain("prefers-reduced-motion")
    expect(shell).toMatch(/viewTransitionName/)
  })

  test("the morph uses the shared 340ms timing and clears its name", () => {
    expect(css).toContain("::view-transition-group(mafw-file-morph)")
    expect(shell).toContain("transition.finished")
  })

  test("editor back reverse-morphs into the file tree row", () => {
    expect(shell).toContain("focusBackNow")
    expect(shell).toMatch(/const focusBack = \(\) => \{[\s\S]*startViewTransition/)
    expect(shell).toContain("fileTreeRowFor")
  })
})
