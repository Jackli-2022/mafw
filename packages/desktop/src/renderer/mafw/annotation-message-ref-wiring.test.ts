import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")

test("ChatPane renders annotation refs from synthetic parts and hydrates by id", () => {
  const chat = read("./components/ChatPane.tsx")
  assert.match(chat, /annotationIDsForParts\(/)
  assert.match(chat, /<AnnotationMessageRefs/)
  assert.match(chat, /onProcessAnnotations/)
  const refs = read("./components/AnnotationMessageRefs.tsx")
  assert.match(refs, /hydrateAnnotationsByIDs\(/)
  assert.match(refs, /annotationsByIDs\(/)
  assert.match(refs, /ButtonV2/)
  assert.doesNotMatch(refs, /<button[\s>]/)
})
