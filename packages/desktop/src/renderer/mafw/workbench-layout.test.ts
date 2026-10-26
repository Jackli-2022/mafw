import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { detentFromLegacy, formatResizePreview, migrateDockKeys, workbenchColumns, workbenchShellHidden } from "./workbench-layout"
describe("workbench layout pure functions", () => {
  test("workbenchColumns：split 三列 / 关闭两列", () => {
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: true }), "0px 520px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 180, chatPx: 640, split: true }), "180px 640px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: false }), "0px minmax(0, 1fr) 0px")
  })

  test("detentFromLegacy：旧 chat 宽度 px → 绝对档位（缺失/非法 → 520）", () => {
    assert.equal(detentFromLegacy("417", 1394), 420)
    assert.equal(detentFromLegacy("558", 1394), 520)
    assert.equal(detentFromLegacy("697", 1394), 640)
    assert.equal(detentFromLegacy(null, 1394), 520)
    assert.equal(detentFromLegacy("abc", 1394), 520)
  })

  test("migrateDockKeys：一次性迁移（新键优先 / 旧 tab 映射 / 旧键删除）", () => {
    const m = new Map<string, string>([
      ["mafw-chat-width", "558"],
      ["mafw-right-dock-width", "520"],
      ["mafw-right-dock-widths", "{}"],
      ["mafw-right-dock-tab", "browser"],
    ])
    const out = migrateDockKeys((k) => m.get(k) ?? null, (k) => m.delete(k), 1394)
    assert.deepEqual(out, { detent: 520, workbenchTab: "browser", terminalOpen: false })
    assert.equal(m.has("mafw-chat-width"), false)
    assert.equal(m.has("mafw-right-dock-width"), false)
    assert.equal(m.has("mafw-right-dock-widths"), false)

    // 新键已存在 → 不覆盖；旧 editor/files/terminal 映射
    const m2 = new Map<string, string>([
      ["mafw-workbench-detent", "640"],
      ["mafw-right-dock-tab", "terminal"],
    ])
    const out2 = migrateDockKeys((k) => m2.get(k) ?? null, (k) => m2.delete(k), 1394)
    assert.deepEqual(out2, { detent: 640, workbenchTab: "editor", terminalOpen: true })

    // 旧 files → editor
    const m3 = new Map<string, string>([["mafw-right-dock-tab", "files"]])
    assert.equal(migrateDockKeys((k) => m3.get(k) ?? null, (k) => m3.delete(k), 1394).workbenchTab, "editor")
  })

  test("workbenchShellHidden：非 chat 视图隐藏（窄屏 overlay 不得盖住其他页）", () => {
    assert.equal(workbenchShellHidden(false), true)
    assert.equal(workbenchShellHidden(true), false)
  })

  test("formatResizePreview：拖动实时 px + 实际比例", () => {
    assert.equal(formatResizePreview(520, 1394), "520px · 37.3%")
    assert.equal(formatResizePreview(437, 1092), "437px · 40%")
    assert.equal(formatResizePreview(100, 0), "100px · 0%")
  })
})
