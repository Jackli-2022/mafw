import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDocumentTabMenu } from "./document-tab"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

test("file document tab menu offers close targets and copy path", () => {
  const menu = buildDocumentTabMenu({
    kind: "file",
    title: "src/a.ts",
    copyValue: "src/a.ts",
    canCloseOthers: true,
    canCloseRight: true,
  })

  assert.deepEqual(ids(menu), [
    "documentTab.close",
    "documentTab.closeOthers",
    "documentTab.closeRight",
    "documentTab.copyPath",
  ])
  assert.deepEqual(validateMenu(menu), [])
})

test("web document tab menu offers copy link and external open", () => {
  const menu = buildDocumentTabMenu({
    kind: "web",
    title: "Example",
    copyValue: "https://example.com",
    canCloseOthers: true,
    canCloseRight: false,
  })

  assert.deepEqual(ids(menu), [
    "documentTab.close",
    "documentTab.closeOthers",
    "documentTab.closeRight",
    "documentTab.copyLink",
    "documentTab.openExternal",
  ])
  assert.deepEqual(validateMenu(menu), [])
})

test("impossible actions are disabled", () => {
  const menu = buildDocumentTabMenu({
    kind: "web",
    title: "空白",
    copyValue: "",
    canCloseOthers: false,
    canCloseRight: false,
  })
  const item = (id: string) =>
    menu.items.find((entry) => entry.type === "item" && entry.id === id) as any

  assert.equal(item("documentTab.closeOthers").disabled, true)
  assert.equal(item("documentTab.closeRight").disabled, true)
  assert.equal(item("documentTab.copyLink").disabled, true)
  assert.equal(item("documentTab.openExternal").disabled, true)
  assert.equal(item("documentTab.close").disabled, undefined)
  assert.deepEqual(validateMenu(menu), [])
})
