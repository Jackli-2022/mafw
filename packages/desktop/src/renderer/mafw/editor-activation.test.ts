import { describe, expect, test } from "bun:test"
import { activationRefreshAction } from "./editor-activation"

// 后台 tab 切回时重新读盘（2026-10-31）：
// - 只读预览（图片/Office）→ stat 比对 mtime，变了才 bump 版本（避免无谓重解析闪帧）
// - 文本 → 读盘；干净时静默换基准，dirty 时只探测冲突、绝不覆盖
// - 二进制/超大只读文本 → 不读（反正不能编辑）
describe("编辑器激活时的磁盘刷新判定", () => {
  test("没有活动文件 → none", () => {
    expect(activationRefreshAction(undefined)).toBe("none")
    expect(activationRefreshAction(null)).toBe("none")
  })

  test("图片/Office 只读预览 → stat-preview", () => {
    for (const kind of ["image", "xlsx", "docx", "pptx"] as const) {
      expect(activationRefreshAction({ kind, dirty: false, readOnly: true })).toBe("stat-preview")
    }
  })

  test("只读文本（binary/超大降级）→ none", () => {
    expect(activationRefreshAction({ kind: "text", dirty: false, readOnly: true })).toBe("none")
    expect(activationRefreshAction({ kind: "markdown", dirty: false, readOnly: true })).toBe("none")
  })

  test("干净文本 → read-text", () => {
    expect(activationRefreshAction({ kind: "text", dirty: false, readOnly: false })).toBe("read-text")
    expect(activationRefreshAction({ kind: "markdown", dirty: false, readOnly: false })).toBe("read-text")
    expect(activationRefreshAction({ kind: "json", dirty: false, readOnly: false })).toBe("read-text")
  })

  test("dirty 文本 → read-text（只用于冲突探测，内容不覆盖）", () => {
    expect(activationRefreshAction({ kind: "text", dirty: true, readOnly: false })).toBe("read-text")
  })
})
