import { describe, expect, test } from "bun:test"
import { buildFileTreeMenu } from "./file-tree"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

const copyChildren = ["fileTree.copy.rel", "fileTree.copy.abs", "fileTree.copy.name"]

describe("buildFileTreeMenu", () => {
  test("file row offers preview and the copy submenu", () => {
    const m = buildFileTreeMenu({ rel: "a.ts", kind: "file", previewable: true })
    expect(ids(m)).toEqual([
      "fileTree.open",
      "fileTree.preview",
      "fileTree.attach",
      "fileTree.reveal",
      "fileTree.copy",
      ...copyChildren,
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("directory row drops preview", () => {
    const m = buildFileTreeMenu({ rel: "src", kind: "dir", previewable: false })
    expect(ids(m)).toEqual([
      "fileTree.open",
      "fileTree.attach",
      "fileTree.reveal",
      "fileTree.copy",
      ...copyChildren,
    ])
  })

  test("non-previewable file drops preview", () => {
    const m = buildFileTreeMenu({ rel: "a.bin", kind: "file", previewable: false })
    expect(ids(m)).not.toContain("fileTree.preview")
  })
})
