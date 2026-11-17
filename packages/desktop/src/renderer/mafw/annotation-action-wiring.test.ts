import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")

test("discussion actions share one shell entry and never create review items", () => {
  const comments = read("./components/CommentsPill.tsx")
  assert.match(comments, /onOpenActions/)
  assert.match(comments, /讨论 \/ 处理|讨论/)

  const editor = read("./components/EditorDock.tsx")
  assert.match(editor, /onDiscussAnnotations/)
  assert.match(editor, /讨论/)

  const chat = read("./components/ChatPane.tsx")
  assert.match(chat, /onProcessAnnotations/)

  const shell = read("./MafwShell.tsx")
  assert.match(shell, /AnnotationActionDialog/)
  assert.match(shell, /deliverAnnotationDiscussion/)
  assert.match(shell, /onProcessAnnotations=\{openAnnotationActions\}/)
  assert.doesNotMatch(shell.slice(shell.indexOf("deliverAnnotationDiscussion")), /createReviewItems/)
})
