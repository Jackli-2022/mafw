import { describe, expect, test } from "bun:test"
import { commandDisabledReason, type CommandCapabilities } from "./command-availability"

const allSupported: CommandCapabilities = {
  summarize: true,
  fork: true,
  diff: true,
  undo: true,
  redo: true,
  rename: true,
  planning: true,
  build: true,
  discovery: true,
}

describe("commandDisabledReason", () => {
  test("returns null when the capability is supported", () => {
    for (const id of ["compact", "fork", "diff", "undo", "redo", "rename", "plan", "build", "skills"] as const) {
      expect(commandDisabledReason(id, allSupported)).toBeNull()
    }
  })

  test("returns a neutral reason when the capability is missing", () => {
    const missing: CommandCapabilities = {
      summarize: false,
      fork: false,
      diff: false,
      undo: false,
      redo: false,
      rename: false,
      planning: false,
      build: false,
      discovery: false,
    }
    expect(commandDisabledReason("compact", missing)).toContain("压缩")
    expect(commandDisabledReason("fork", missing)).toContain("分叉")
    expect(commandDisabledReason("diff", missing)).toContain("diff")
    expect(commandDisabledReason("undo", missing)).toContain("回退")
    expect(commandDisabledReason("redo", missing)).toContain("撤销")
    expect(commandDisabledReason("rename", missing)).toContain("重命名")
    expect(commandDisabledReason("plan", missing)).toContain("规划")
    expect(commandDisabledReason("build", missing)).toContain("默认执行")
    expect(commandDisabledReason("skills", missing)).toContain("技能")
  })
})
