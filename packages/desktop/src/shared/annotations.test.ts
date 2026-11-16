import { describe, expect, test } from "bun:test"
import { createAnnotationRepo, setAnnotationHeld } from "./annotations"
import type { Annotation, AnnotationDb } from "./annotation-types"

const base = (over: Partial<Annotation> = {}): Annotation => ({
  id: "a1",
  sessionID: "s1",
  rel: "a.md",
  startLine: 1,
  endLine: 1,
  code: "x",
  comment: "note",
  createdAt: 1000,
  ...over,
})

describe("shared annotations repo", () => {
  test("setAnnotationHeld 只改目标批注的 held", () => {
    const db: AnnotationDb = { s1: [base(), base({ id: "a2", comment: "other" })] }
    const next = setAnnotationHeld(db, "s1", "a1", true)
    expect(next.s1.map((a) => [a.id, a.held])).toEqual([["a1", true], ["a2", undefined]])
  })

  test("setAnnotationHeld 对不存在的 id 保持原列表内容", () => {
    const db: AnnotationDb = { s1: [base()] }
    const next = setAnnotationHeld(db, "s1", "missing", true)
    expect(next.s1).toEqual([base()])
  })

  test("repo.setHeld 持久化到 store 且可再读出", () => {
    const mem = new Map<string, unknown>()
    const store = {
      get: (key: string) => mem.get(key),
      set: (key: string, value: unknown) => { mem.set(key, value) },
    }
    const repo = createAnnotationRepo(store)
    const a = repo.add(base() as Omit<Annotation, "id" | "createdAt">)
    repo.setHeld("s1", a.id, true)
    expect(repo.list("s1")[0].held).toBe(true)
    repo.setHeld("s1", a.id, false)
    expect(repo.list("s1")[0].held).toBe(false)
  })
})
