import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("批注草稿接线", () => {
  test("main 持久化 + IPC + preload 命名空间", () => {
    const main = read("src/shared/annotations.ts")
    expect(main).toContain("createAnnotationRepo")
    const ipc = read("src/main/ipc.ts")
    expect(ipc).toContain("annotations-list")
    expect(ipc).toContain("annotations-add")
    const preload = read("src/preload/index.ts")
    expect(preload).toContain("annotations:")
    const types = read("src/preload/types.ts")
    expect(types).toContain("AnnotationsAPI")
  })
  test("composer 挂载待发送批注列表", () => {
    const chat = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(chat).toContain("PendingAnnotations")
  })
  test("编辑器批注双动作（加入批注 / 立即发送）", () => {
    const editor = read("src/renderer/mafw/components/EditorDock.tsx")
    expect(editor).toContain("onAddAnnotation")
    expect(editor).toContain("secondaryLabel")
  })
  test("diff 行评论同样可加入草稿", () => {
    const diff = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
    expect(diff).toContain("onAddAnnotation")
    expect(diff).toContain("加入批注")
  })
  test("发送打包收敛在 use-send-message（入队前打包 + 纯批注可发）", () => {
    const hook = read("src/renderer/mafw/chat/use-send-message.ts")
    expect(hook).toContain("takeAnnotations")
    expect(hook).toContain("formatAnnotations")
    expect(hook).toMatch(/pendingAnnotationCount[\s\S]{0,200}atts\.length/)
  })
})
