import { describe, expect, test } from "bun:test"
import { clearAllDrafts, clearRoot, getDraft, getEol, getMtime, setDraft, setEol, setMtime } from "./editor-drafts"

describe("editor-drafts（跨组件 root-scoped 草稿/基准存储）", () => {
  test("draft 按 (root, rel) 隔离：不同 root 同名文件互不影响", () => {
    setDraft("C:\\a", "src/x.ts", "draft-A")
    setDraft("D:\\b", "src/x.ts", "draft-B")
    expect(getDraft("C:\\a", "src/x.ts")).toBe("draft-A")
    expect(getDraft("D:\\b", "src/x.ts")).toBe("draft-B")
    clearAllDrafts()
    expect(getDraft("C:\\a", "src/x.ts")).toBeUndefined()
  })
  test("mtime / eol 同 key 语义；clearRoot 只清该 root", () => {
    setMtime("C:\\a", "x.ts", 111)
    setMtime("D:\\b", "x.ts", 222)
    setEol("C:\\a", "x.ts", "\r\n")
    expect(getMtime("C:\\a", "x.ts")).toBe(111)
    expect(getEol("C:\\a", "x.ts")).toBe("\r\n")
    clearRoot("C:\\a")
    expect(getMtime("C:\\a", "x.ts")).toBeUndefined()
    expect(getMtime("D:\\b", "x.ts")).toBe(222)
    clearAllDrafts()
  })
})
