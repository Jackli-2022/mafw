import { describe, expect, test } from "bun:test"
import { buildFilePathMenu } from "./file-path"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildFilePathMenu", () => {
  test("has open-with and copy submenus", () => {
    const m = buildFilePathMenu({ root: "C:/r", rel: "a/b.ts", inRoot: true, canOpenEditor: true })
    expect(ids(m)).toEqual([
      "filePath.attach",
      "filePath.openEditor",
      "filePath.openWith",
      "filePath.openWith.default",
      "filePath.openWith.vscode",
      "filePath.openWith.cursor",
      "filePath.openWith.zed",
      "filePath.reveal",
      "filePath.copy",
      "filePath.copy.abs",
      "filePath.copy.rel",
      "filePath.copy.name",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("outside-root paths lose the editor item", () => {
    const m = buildFilePathMenu({ root: "C:/r", rel: "../x.ts", inRoot: false, canOpenEditor: true })
    expect(ids(m)).not.toContain("filePath.openEditor")
    expect(validateMenu(m)).toEqual([])
  })
})
