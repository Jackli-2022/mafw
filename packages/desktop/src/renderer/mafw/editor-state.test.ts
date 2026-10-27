import { describe, expect, test } from "bun:test"
import { createEditorModel as create, onRootChange, openFile, closeFile, markDirty, markSaved, onExternalChange, resolveConflict, applyCleanReload, canApplyCleanReload } from "./editor-state"

describe("editor-state", () => {
  test("openFile 建行并激活；重复打开仅激活不重置内容", () => {
    let m = openFile(create(), "a.ts", "v1")
    m = openFile(m, "b.ts", "v2")
    m = openFile(m, "a.ts", "IGNORED")
    expect(m.active).toBe("a.ts")
    expect(m.files.find(f => f.rel === "a.ts")!.savedContent).toBe("v1")
  })
  test("dirty + 外部改动 → conflict；干净 + 外部改动 → staleClean", () => {
    let m = openFile(create(), "a.ts", "v1")
    m = markDirty(m, "a.ts")
    m = onExternalChange(m, "a.ts")
    expect(m.files[0]).toMatchObject({ conflict: true, staleClean: false })
    let m2 = openFile(create(), "b.ts", "v1")
    m2 = onExternalChange(m2, "b.ts")
    expect(m2.files[0]).toMatchObject({ conflict: false, staleClean: true })
  })
  test("resolveConflict keep-mine 清冲突保 dirty；reload 用磁盘内容重置", () => {
    let m = markDirty(openFile(create(), "a.ts", "v1"), "a.ts")
    m = onExternalChange(m, "a.ts")
    const keep = resolveConflict(m, "a.ts", "keep-mine")
    expect(keep.files[0]).toMatchObject({ conflict: false, dirty: true, savedContent: "v1" })
    const rel = resolveConflict(m, "a.ts", "reload", "v2-disk")
    expect(rel.files[0]).toMatchObject({ conflict: false, dirty: false, savedContent: "v2-disk" })
  })
  test("applyCleanReload 清 staleClean 并换基准", () => {
    let m = onExternalChange(openFile(create(), "a.ts", "v1"), "a.ts")
    m = applyCleanReload(m, "a.ts", "v2")
    expect(m.files[0]).toMatchObject({ staleClean: false, savedContent: "v2" })
  })
  test("markSaved 换基准清 dirty；onRootChange 清空全部", () => {
    let m = markSaved(markDirty(openFile(create(), "a.ts", "v1"), "a.ts"), "a.ts", "v1.5")
    expect(m.files[0]).toMatchObject({ dirty: false, savedContent: "v1.5" })
    m = onRootChange(m, "D:\\other")
    expect(m.files).toEqual([]); expect(m.active).toBeNull(); expect(m.root).toBe("D:\\other")
  })
  test("closeFile 关闭 active → 激活剩余最近打开项", () => {
    let m = openFile(openFile(create(), "a.ts", "1"), "b.ts", "2")
    m = closeFile(m, "b.ts")
    expect(m.active).toBe("a.ts")
    expect(closeFile(m, "a.ts").active).toBeNull()
  })
  test("canApplyCleanReload：仅干净且存在的文件可静默刷新（防 await 期间用户输入被覆盖）", () => {
    let m = openFile(create(), "a.ts", "v1")
    expect(canApplyCleanReload(m, "a.ts")).toBe(true)
    expect(canApplyCleanReload(markDirty(m, "a.ts"), "a.ts")).toBe(false)
    expect(canApplyCleanReload(m, "missing.ts")).toBe(false)
  })
})

describe("files preview kinds（2026-10-27：图片预览 tab）", () => {
  test("openFile 带 kind=image：readOnly、不参与 dirty/保存/冲突", () => {
    let m = openFile(create(), "a.png", "", true, "image")
    expect(m.files[0].kind).toBe("image")
    expect(m.files[0].readOnly).toBe(true)
    expect(m.files[0].dirty).toBe(false)
    m = markDirty(m, "a.png")
    expect(m.files[0].dirty).toBe(false)
    m = onExternalChange(m, "a.png")
    expect(m.files[0].conflict).toBe(false)
    expect(m.files[0].staleClean).toBe(false)
    m = markSaved(m, "a.png", "x")
    expect(m.files[0].dirty).toBe(false)
  })
  test("默认 kind=text；svg 保留 kind 且照常可 dirty/保存", () => {
    let m = openFile(create(), "a.ts", "v1")
    expect(m.files[0].kind).toBe("text")
    m = openFile(m, "logo.svg", "<svg/>", false, "svg")
    expect(m.files.find(f => f.rel === "logo.svg")!.kind).toBe("svg")
    m = markDirty(m, "logo.svg")
    expect(m.files.find(f => f.rel === "logo.svg")!.dirty).toBe(true)
    m = markSaved(m, "logo.svg", "<svg/>")
    expect(m.files.find(f => f.rel === "logo.svg")!.dirty).toBe(false)
  })
  test("重复打开不重置 kind（切回已有图片 tab）", () => {
    let m = openFile(create(), "a.png", "", true, "image")
    m = openFile(m, "a.png", "", true, "text")
    expect(m.files[0].kind).toBe("image")
  })
})

describe("table kind（CSV/TSV 表格预览，2026-10-27 增补）", () => {
  test("table 照常 dirty/保存（源码态可编辑），外部变更走冲突语义", () => {
    let m = openFile(create(), "data.csv", "a,b", false, "table")
    expect(m.files[0].kind).toBe("table")
    m = markDirty(m, "data.csv")
    expect(m.files[0].dirty).toBe(true)
    m = onExternalChange(m, "data.csv")
    expect(m.files[0].conflict).toBe(true)
  })
})
