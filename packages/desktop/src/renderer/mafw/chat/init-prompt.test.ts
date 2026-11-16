import { describe, expect, test } from "bun:test"
import { INIT_AGENTS_PROMPT } from "./init-prompt"

describe("INIT_AGENTS_PROMPT", () => {
  test("asks the agent to preserve AGENTS.md and avoid git commits", () => {
    expect(INIT_AGENTS_PROMPT).toContain("AGENTS.md")
    expect(INIT_AGENTS_PROMPT).toMatch(/保留现有内容/)
    expect(INIT_AGENTS_PROMPT).toMatch(/不要提交 git/)
    expect(INIT_AGENTS_PROMPT).toMatch(/破坏性命令/)
  })
})
