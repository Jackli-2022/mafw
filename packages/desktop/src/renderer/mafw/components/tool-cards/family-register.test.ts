import { describe, expect, test } from "bun:test"
import type { ToolRegistryEntry } from "@mafw/session-ui/tool-registry"
import { registerFamilyCards } from "./family-register"
import { TOOL_SPECS } from "./extract"
import { aliasKeys } from "./registered-tools"

describe("registerFamilyCards", () => {
  test("registers present + renderSections for every spec alias, without a legacy render", () => {
    const entries: ToolRegistryEntry[] = []
    registerFamilyCards({ register: (entry) => entries.push(entry) }, () => null)

    expect(entries).toHaveLength(Object.keys(TOOL_SPECS).length * 2)
    for (const name of Object.keys(TOOL_SPECS)) {
      for (const key of aliasKeys(name)) {
        const entry = entries.find((candidate) => candidate.name === key)
        expect(entry?.present).toBeDefined()
        expect(entry?.renderSections).toBeDefined()
        expect(entry?.render).toBeUndefined()
      }
    }
  })
})
