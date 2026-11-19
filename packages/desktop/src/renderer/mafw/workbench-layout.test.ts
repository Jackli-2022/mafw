import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { detentFromLegacy, formatResizePreview, migrateDockKeys, workbenchColumns, workbenchFocusActive, workbenchShellHidden, workbenchSplit } from "./workbench-layout"
describe("workbench layout pure functions", () => {
  test("workbenchColumns：split 三列 / 关闭两列 / Focus 收 chat", () => {
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: true, focus: false }), "0px 520px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 180, chatPx: 640, split: true, focus: false }), "180px 640px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: false, focus: false }), "0px minmax(0, 1fr) 0px")
    assert.equal(workbenchColumns({ leftPx: 46, chatPx: 760, split: true, focus: true }), "46px 0px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 46, chatPx: 760, split: true, focus: false }), "46px 760px minmax(0, 1fr)")
  })

  test("workbenchColumns：narrow 只显示 Chat 或 Workbench，不并排", () => {
    assert.equal(workbenchColumns({
      leftPx: 46, chatPx: 760, split: true, focus: false,
      narrow: true, narrowWorkbench: false,
    }), "46px minmax(0, 1fr) 0px")
    assert.equal(workbenchColumns({
      leftPx: 46, chatPx: 760, split: true, focus: false,
      narrow: true, narrowWorkbench: true,
    }), "46px 0px minmax(0, 1fr)")
    assert.equal(workbenchColumns({
      leftPx: 0, chatPx: 760, split: false, focus: false,
      narrow: true, narrowWorkbench: false,
    }), "0px minmax(0, 1fr) 0px")
  })

  test("detentFromLegacy：旧 chat 宽度 px → 绝对档位（缺失/非法 → 760）", () => {
    assert.equal(detentFromLegacy("417", 1394), 520)
    assert.equal(detentFromLegacy("558", 1394), 520)
    assert.equal(detentFromLegacy("697", 1394), 760)
    assert.equal(detentFromLegacy("750", 1394), 760)
    assert.equal(detentFromLegacy(null, 1394), 760)
    assert.equal(detentFromLegacy("abc", 1394), 760)
  })

  test("migrateDockKeys：一次性迁移（新键优先 / 旧键删除 / 终端默认开）", () => {
    const m = new Map<string, string>([
      ["mafw-chat-width", "558"],
      ["mafw-right-dock-width", "520"],
      ["mafw-right-dock-widths", "{}"],
      ["mafw-right-dock-tab", "browser"],
    ])
    const out = migrateDockKeys((k) => m.get(k) ?? null, (k) => m.delete(k), 1394)
    assert.deepEqual(out, { detent: 520, terminalOpen: true })
    assert.equal(m.has("mafw-chat-width"), false)
    assert.equal(m.has("mafw-right-dock-width"), false)
    assert.equal(m.has("mafw-right-dock-widths"), false)

    const m2 = new Map<string, string>([
      ["mafw-workbench-detent", "640"],
      ["mafw-right-dock-tab", "terminal"],
    ])
    const out2 = migrateDockKeys((k) => m2.get(k) ?? null, (k) => m2.delete(k), 1394)
    assert.deepEqual(out2, { detent: 640, terminalOpen: true })

    // 旧 420 档（新键已存在）→ 新默认 760；无任何存储 → 760 / 终端开
    const m4 = new Map<string, string>([["mafw-workbench-detent", "420"]])
    assert.equal(migrateDockKeys((k) => m4.get(k) ?? null, (k) => m4.delete(k), 1394).detent, 760)
    const fresh = migrateDockKeys(() => null, () => {}, 1394)
    assert.deepEqual(fresh, { detent: 760, terminalOpen: true })
  })

  test("workbenchFocusActive：dock 打开时才允许全宽", () => {
    assert.equal(workbenchFocusActive({ focus: true, open: true }), true)
    assert.equal(workbenchFocusActive({ focus: true, open: false }), false)
    assert.equal(workbenchFocusActive({ focus: false, open: true }), false)
  })

  test("workbenchSplit：dock 开关就是唯一门控", () => {
    assert.equal(workbenchSplit({ open: true }), true)
    assert.equal(workbenchSplit({ open: false }), false)
  })

  test("workbenchShellHidden：只由手动关闭决定", () => {
    assert.equal(workbenchShellHidden({ open: true }), false)
    assert.equal(workbenchShellHidden({ open: false }), true)
  })

  test("formatResizePreview：拖动实时 px + 实际比例", () => {
    assert.equal(formatResizePreview(520, 1394), "520px · 37.3%")
    assert.equal(formatResizePreview(760, 1394), "760px · 54.5%")
    assert.equal(formatResizePreview(437, 1092), "437px · 40%")
    assert.equal(formatResizePreview(100, 0), "100px · 0%")
  })
})
