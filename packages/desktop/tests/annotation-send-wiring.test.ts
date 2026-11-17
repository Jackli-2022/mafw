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
  test("composer 挂载 comments pill（待发送批注）", () => {
    const chat = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(chat).toContain("CommentsPill")
    expect(chat).toContain("sendableFor")
  })
  test("编辑器批注交互（选区 toolbar → 300px composer → 高亮 + margin rail）", () => {
    const editor = read("src/renderer/mafw/components/EditorDock.tsx")
    expect(editor).toContain("onAddAnnotation")
    expect(editor).toContain("AnnotationSheet")
    expect(editor).toContain("submitAnnotationAnchored")
    expect(editor).toContain("selectionBar")
    expect(editor).toContain("mafw-annot-rail")
  })
  test("diff 行评论同样可加入草稿", () => {
    const diff = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
    expect(diff).toContain("onAddAnnotation")
    expect(diff).toContain("加入批注")
  })
  test("发送打包收敛在 use-send-message（讨论消息 + 成功后标记已讨论）", () => {
    const hook = read("src/renderer/mafw/chat/use-send-message.ts")
    expect(hook).toContain("peekAnnotations")
    expect(hook).toContain("formatAnnotations")
    expect(hook).toContain("annotationRefPart")
    expect(hook).toContain("markAnnotationsDiscussed")
    expect(hook).toContain("hasAnnotations")
    expect(hook).not.toContain("persistAnnotations")
    expect(hook).not.toContain("takeAnnotations")
    expect(hook).not.toContain("createReviewItems")
  })
})
