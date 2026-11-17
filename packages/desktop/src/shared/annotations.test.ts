import { describe, expect, test } from "bun:test"
import {
  createAnnotationRepo,
  findAnnotationsByIds,
  patchAnnotation,
  setAnnotationHeld,
} from "./annotations"
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

  test("patch only changes lifecycle/source fields", () => {
    const db: AnnotationDb = { s1: [base()] }
    const next = patchAnnotation(db, "s1", "a1", {
      discussedAt: 10,
      delegatedAt: 20,
      reviewItemIDs: ["review_1"],
      capturedDirty: true,
      contentVersion: "v1",
      id: "hacked",
      sessionID: "hacked",
      createdAt: 999,
    } as any)
    expect(next.s1[0]).toMatchObject({
      id: "a1",
      sessionID: "s1",
      createdAt: 1000,
      discussedAt: 10,
      delegatedAt: 20,
      reviewItemIDs: ["review_1"],
      capturedDirty: true,
      contentVersion: "v1",
    })
  })

  test("findByIds spans session buckets and no-session drafts survive repo recreation", () => {
    const mem = new Map<string, unknown>()
    const store = {
      get: (key: string) => mem.get(key),
      set: (key: string, value: unknown) => { mem.set(key, value) },
    }
    const repo = createAnnotationRepo(store)
    repo.add({ ...base({ id: "draft-1", sessionID: "draft:project:C:/repo" }) } as Omit<Annotation, "id" | "createdAt">)
    const recreated = createAnnotationRepo(store)
    expect(recreated.list("draft:project:C:/repo").map((a) => a.id)).toEqual(["draft-1"])
    const db = { s1: [base()], "draft:project:C:/repo": recreated.list("draft:project:C:/repo") }
    expect(findAnnotationsByIds(db, ["a1", "draft-1"]).map((a) => a.id)).toEqual(["a1", "draft-1"])
  })
})
