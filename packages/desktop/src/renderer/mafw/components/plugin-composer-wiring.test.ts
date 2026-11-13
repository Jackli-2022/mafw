import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8")

test("the composer mounts declarative plugin actions", () => {
  expect(read("ChatPane.tsx")).toContain("<PluginComposerActions sessionID={sidProp()} />")
})

test("plugin composer actions invoke package actions and insert draft text", () => {
  const source = read("../plugins/PluginComposerActions.tsx")
  expect(source).toContain("window.api.mafw.plugins.invoke")
  expect(source).toContain("pushComposerInsert")
  expect(source).toContain("disabled={!props.sessionID}")
})
