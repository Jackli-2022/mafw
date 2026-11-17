import { describe, expect, test } from "bun:test"
import { anchorOccursIn, annotationSourceProblem, textFingerprint } from "./annotation-source"
import type { Annotation } from "../../shared/annotation-types"

const annotation = (over: Partial<Annotation> = {}): Annotation => ({
  id: "ann-1",
  sessionID: "s1",
  rel: "a.ts",
  startLine: 2,
  endLine: 2,
  code: "const x = 1",
  comment: "note",
  createdAt: 1,
  source: { kind: "project", projectDir: "C:/repo" },
  ...over,
})

describe("annotation source", () => {
  test("fingerprint is stable and changes with content", () => {
    expect(textFingerprint("hello")).toBe(textFingerprint("hello"))
    expect(textFingerprint("hello")).not.toBe(textFingerprint("hello!"))
    expect(textFingerprint("")).toMatch(/:[0-9]+$/)
  })

  test("dirty captures are discussable but not delegable", () => {
    expect(annotationSourceProblem(annotation({ capturedDirty: true }))).toMatch(/保存/)
    expect(annotationSourceProblem(annotation({ source: undefined }))).toMatch(/来源/)
    expect(annotationSourceProblem(annotation())).toBeNull()
  })

  test("anchor lookup is exact and rejects stale source", () => {
    expect(anchorOccursIn("line1\nconst x = 1\nline3", annotation())).toBe(true)
    expect(anchorOccursIn("line1\nconst x = 2\nline3", annotation())).toBe(false)
    expect(anchorOccursIn("const x = 1\nconst x = 1", annotation())).toBe(false)
    expect(anchorOccursIn("原文 A", annotation({ code: "", anchor: { kind: "quote", quote: "原文 A" } })))
      .toBe(true)
  })
})
