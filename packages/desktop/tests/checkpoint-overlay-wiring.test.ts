import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("checkpoint overlay wiring", () => {
  test("overlay builds checkpoints, gates actions, and confirms", () => {
    const src = read("src/renderer/mafw/components/CheckpointOverlay.tsx")
    expect(src).toContain("buildCheckpoints")
    expect(src).toContain("checkpointsToRewind")
    expect(src).toContain("revertWarning")
    expect(src).toContain("canRewindCode")
    expect(src).toContain("filesKnown")
    const hasRequest = src.includes("const request =")
    const hasConfirm = src.includes("const confirm = async")
    expect(hasRequest && hasConfirm).toBe(true)
    expect(src).toContain("caps?.diffApi")
    expect(src).toContain("caps?.sessionBranchApi")
    expect(src).toContain("最新回合")
    expect(src).toContain("onRevertCode")
    expect(src).toContain('role="dialog"')
  })

  test("checkpoint CSS exists", () => {
    const css = read("src/renderer/mafw/mafw.css")
    expect(css).toContain(".mafw-checkpoint-panel")
    expect(css).toContain(".mafw-checkpoint-row")
    expect(css).toContain(".mafw-checkpoint-confirm")
  })
})
