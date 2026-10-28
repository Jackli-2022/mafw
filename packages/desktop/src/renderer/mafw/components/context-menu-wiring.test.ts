import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8")

test("shell surfaces request menus from builders", () => {
  expect(read("IconRail.tsx")).toContain("buildRailNewMenu")
  expect(read("LeftDock.tsx")).toContain("buildSessionMenu")
  expect(read("LeftDock.tsx")).toContain("buildProjectMenu")
  expect(read("SessionStrip.tsx")).toContain("buildSessionMenu")
})

test("no synthetic contextmenu events remain", () => {
  expect(read("LeftDock.tsx")).not.toContain('new MouseEvent("contextmenu"')
})

test("rows and tabs are keyboard focusable", () => {
  expect(read("LeftDock.tsx")).toMatch(/mafw-rail-session[^>]*tabIndex=\{0\}/)
  expect(read("SessionStrip.tsx")).toMatch(/mafw-session-tab[^>]*tabIndex=\{0\}/)
})

test("session delete still goes through the confirm state", () => {
  expect(read("LeftDock.tsx")).toContain("setDeleteConfirmId")
})

test("file surfaces are wired", () => {
  expect(read("../../../../../session-ui/src/components/markdown.tsx")).toContain("dataset.filePath")
  expect(read("../../../../../session-ui/src/components/message-part.tsx")).toContain("data-file-path")
  expect(read("../../../../../session-ui/src/components/session-turn.tsx")).toContain("data-message-role")
  expect(read("ChatPane.tsx")).toContain("buildFilePathMenu")
  expect(read("FilesDock.tsx")).toContain("buildFileTreeMenu")
  expect(read("EditorDock.tsx")).toContain("buildEditorTabMenu")
})

test("message, terminal and browser surfaces are wired", () => {
  expect(read("ChatPane.tsx")).toContain("buildMessageMenu")
  expect(read("ChatPane.tsx")).toContain("buildCodeBlockMenu")
  expect(read("TerminalDock.tsx")).toContain("buildTerminalMenu")
  expect(read("BrowserDock.tsx")).toContain("buildBrowserMenu")
})
