import { describe, expect, test } from "bun:test"
import { createEditorModel, openFile, openPreviewFile } from "./editor-state"
import { createBrowserTab } from "./browser-tabs"
import { browserDocumentTabs, editorDocumentTabs, tabStripWheelDelta } from "./document-frame-model"

describe("DocumentFrame tab mapping", () => {
  test("editor files keep identity, basename, dirty/preview/read-only state", () => {
    let model = createEditorModel()
    model = openFile(model, "docs/architecture/desktop.md", "x")
    model = openFile(model, "src/a.ts", "y")
    model = { ...model, files: model.files.map((file) => file.rel === "src/a.ts" ? { ...file, dirty: true } : file) }
    model = openPreviewFile(model, "README.md", "z")

    const tabs = editorDocumentTabs(model)
    expect(tabs.map((tab) => tab.id)).toEqual(["docs/architecture/desktop.md", "src/a.ts", "README.md"])
    expect(tabs[0]).toMatchObject({ label: "desktop.md", icon: "file", active: false })
    expect(tabs[1]).toMatchObject({ label: "a.ts", dirty: true, active: false })
    expect(tabs[2]).toMatchObject({ label: "README.md", preview: true, active: true })
  })

  test("browser tabs use the browser title and active tab id", () => {
    const tabs = [
      createBrowserTab("http://localhost:3000/usage", "browser-tab-1", "Orcalore Usage"),
      createBrowserTab("", "browser-tab-2"),
    ]
    const mapped = browserDocumentTabs(tabs, "browser-tab-2")
    expect(mapped[0]).toMatchObject({ id: "browser-tab-1", label: "Orcalore Usage", icon: "globe", active: false })
    expect(mapped[1]).toMatchObject({ id: "browser-tab-2", label: "新标签页", icon: "globe", active: true })
  })

  test("tab strip wheel maps vertical wheel to horizontal scroll", () => {
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 120 }, 800)).toBe(120)
    expect(tabStripWheelDelta({ deltaX: 80, deltaY: 20 }, 800)).toBe(80)
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toBe(48)
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800)).toBe(800)
    expect(tabStripWheelDelta({ deltaX: 0, deltaY: 0 }, 800)).toBe(0)
  })
})
