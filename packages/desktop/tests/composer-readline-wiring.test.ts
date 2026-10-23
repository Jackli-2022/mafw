import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("composer readline wiring", () => {
  test("ChatPane consumes applyReadlineKey and guards Ctrl+F inside composer", () => {
    const pane = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(pane).toContain("applyReadlineKey(")
    expect(pane).toContain("readlineEdit")
    expect(pane).toContain('closest?.(".mafw-composer")')
  })

  test("MafwShell guards Ctrl+K inside composer", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain('closest?.(".mafw-composer")')
    expect(shell).toContain('toggleLeftDock("search")')
  })
})
