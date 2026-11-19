import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"

const componentSource = fs.readFileSync(new URL("./message-part.tsx", import.meta.url), "utf-8")

describe("read tool card", () => {
  test("renders its output in a collapsible body like list/glob/grep", () => {
    const start = componentSource.indexOf('name: "read"')
    const end = componentSource.indexOf('name: "list"')
    const block = componentSource.slice(start, end)
    expect(block).toContain('data-component="tool-output"')
    expect(block).toContain("Markdown text={props.output!}")
  })
})

describe("ToolPartDisplay presentation wiring", () => {
  test("passes normalized history output and uses the shared ToolCard", () => {
    expect(componentSource).toContain("partOutputText(part().state)")
    expect(componentSource).toContain("<ToolCard")
  })

  test("does not pass raw state.output only", () => {
    expect(componentSource).not.toContain("output={part().state.output}")
  })

  test("uses the override-aware decision and generic fallback", () => {
    expect(componentSource).toContain("shouldUsePresentation")
    expect(componentSource).toContain("genericPresentation")
    expect(componentSource).toContain("resolveToolEntry")
  })
})

describe("diff tools use the shared presentation path", () => {
  const block = (name: string, next: string) => {
    const start = componentSource.indexOf(`name: "${name}"`)
    return componentSource.slice(start, componentSource.indexOf(`name: "${next}"`, start))
  }

  test("edit/write/apply_patch register present + renderBody without a legacy shell", () => {
    const edit = block("edit", "write")
    expect(edit).toContain('present: (ctx) => presentDiffTool("edit", ctx)')
    expect(edit).toContain("renderBody: EditBody")
    expect(edit).not.toContain("BasicTool")

    const write = block("write", "apply_patch")
    expect(write).toContain('present: (ctx) => presentDiffTool("write", ctx)')
    expect(write).toContain("renderBody: WriteBody")

    const patch = block("apply_patch", "todowrite")
    expect(patch).toContain('present: (ctx) => presentDiffTool("apply_patch", ctx)')
    expect(patch).toContain("renderBody: ApplyPatchBody")
  })

  test("details mode still drives defaultOpen and error parts stay generic", () => {
    expect(componentSource).toContain("defaultOpen={props.defaultOpen}")
    for (const [name, next] of [["edit", "write"], ["write", "apply_patch"], ["apply_patch", "todowrite"]] as const) {
      expect(block(name, next)).not.toContain("handlesError")
    }
  })

  test("keeps a file path on the always-rendered tool wrapper", () => {
    expect(componentSource).toMatch(/data-component="tool-part-wrapper"[\s\S]{0,160}data-file-path=/)
    expect(componentSource).toContain('part().toolClass !== "file-edit"')
  })
})

describe("rich tools use the shared presentation path", () => {
  const block = (name: string, next?: string) => {
    const start = componentSource.indexOf(`name: "${name}"`)
    const end = next ? componentSource.indexOf(`name: "${next}"`, start) : undefined
    return componentSource.slice(start, end)
  }

  test("task/question/skill register present and body slots", () => {
    expect(block("task", "bash")).toContain("present: presentTask")
    expect(block("task", "bash")).toContain("renderBody: TaskBody")
    expect(block("question", "skill")).toContain("present: presentQuestion")
    expect(block("question", "skill")).toContain("renderBody: QuestionBody")
    expect(block("skill")).toContain("present: presentSkill")
    expect(block("task", "bash")).not.toContain("BasicTool")
    expect(block("task", "bash")).not.toContain("task-tool-card")
  })

  test("the presentation context resolves agent and child session", () => {
    expect(componentSource).toContain("agent: (name) => presentationAgent(name, data.store.agent)")
    expect(componentSource).toContain("subagentSession:")
    expect(componentSource).toContain("taskSessionForParent(taskInput")
  })
})

describe("rich card bodies", () => {
  test("task and question keep body-only components", () => {
    expect(componentSource).toContain("function TaskBody")
    expect(componentSource).toContain('data-component="task-detail"')
    expect(componentSource).toContain("function QuestionBody")
    expect(componentSource).toContain('data-component="question-answers"')
  })

  test("ToolCard receives the session navigation callback", () => {
    expect(componentSource).toContain("onOpenSession")
  })

  test("fallback keeps subagent navigation and part-parent resolution", () => {
    const start = componentSource.indexOf("export function ToolPresentationFallback")
    const end = componentSource.indexOf('PART_MAPPING["tool"]', start)
    const fallback = componentSource.slice(start, end)
    expect(fallback).toContain("onOpenSession")
    expect(fallback).toContain("taskSessionForParent(taskInput, props.sessionID")
    expect(fallback).toContain("presentationAgent(name, data.store.agent)")
  })

  test("task body resolves against the part parent, not the route", () => {
    const start = componentSource.indexOf("function TaskBody")
    const end = componentSource.indexOf("function QuestionBody", start)
    const body = componentSource.slice(start, end)
    expect(body).toContain("taskSessionForParent(input(), props.sessionID")
  })

  test("question body falls back when there are no questions", () => {
    expect(componentSource).toContain("questions().length > 0 && answers().length > 0")
  })

  test("forwards the desktop section renderer to ToolCard", () => {
    expect(componentSource).toContain("renderSections={entry()?.renderSections}")
    expect(componentSource).toContain("renderSections={props.entry.renderSections}")
  })

  test("does not keep the legacy getToolInfo duplicate", () => {
    expect(componentSource).not.toContain("function getToolInfo")
    expect(componentSource).not.toContain("type ToolInfo")
    expect(componentSource).not.toContain("function agentTitle")
    expect(componentSource).not.toContain("UiI18n")
    expect(componentSource).not.toContain("IconProps")
  })
})

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})
