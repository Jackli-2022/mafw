import { describe, expect, test } from "bun:test"
import type { Annotation } from "../src/shared/annotation-types"
import {
  addAnnotation,
  clearAnnotations,
  createAnnotationRepo,
  listAnnotations,
  removeAnnotation,
} from "../src/shared/annotations"

const a = (over: Partial<Annotation> = {}): Annotation => ({
  id: "a1", sessionID: "s1", rel: "src/a.ts", startLine: 3, endLine: 5,
  code: "x()", comment: "问", createdAt: 1000, ...over,
})

describe("纯 reducer（不可变）", () => {
  test("add：按会话追加，原对象不变", () => {
    const db = {}
    const next = addAnnotation(db, a())
    expect(listAnnotations(next, "s1")).toHaveLength(1)
    expect(listAnnotations(db, "s1")).toHaveLength(0)
  })
  test("list：只返回该会话，按 createdAt 升序", () => {
    let db = addAnnotation({}, a({ id: "a2", createdAt: 2000 }))
    db = addAnnotation(db, a({ id: "a1", createdAt: 1000 }))
    db = addAnnotation(db, a({ id: "b1", sessionID: "s2", createdAt: 500 }))
    expect(listAnnotations(db, "s1").map(x => x.id)).toEqual(["a1", "a2"])
  })
  test("remove：只删目标 id 且不跨会话", () => {
    let db = addAnnotation({}, a({ id: "a1" }))
    db = addAnnotation(db, a({ id: "a2" }))
    db = addAnnotation(db, a({ id: "b1", sessionID: "s2" }))
    const next = removeAnnotation(db, "s1", "a1")
    expect(listAnnotations(next, "s1").map(x => x.id)).toEqual(["a2"])
    expect(listAnnotations(next, "s2")).toHaveLength(1)
  })
  test("clear：只清该会话，其他会话保留", () => {
    let db = addAnnotation({}, a())
    db = addAnnotation(db, a({ id: "b1", sessionID: "s2" }))
    const next = clearAnnotations(db, "s1")
    expect(listAnnotations(next, "s1")).toEqual([])
    expect(listAnnotations(next, "s2")).toHaveLength(1)
  })
})

describe("createAnnotationRepo（注入 store，electron 无关）", () => {
  const fake = () => {
    let value: unknown = undefined
    return {
      store: { get: (_k: string) => value, set: (_k: string, v: unknown) => { value = v } },
      raw: () => value,
    }
  }
  test("空 store → 空表；add 后落盘；remove/clear 同步", () => {
    const f = fake()
    const repo = createAnnotationRepo(f.store)
    expect(repo.list("s1")).toEqual([])
    const saved = repo.add(a())
    expect(saved.id).toBe("a1")
    expect((f.raw() as any).s1).toHaveLength(1)
    expect(repo.remove("s1", "a1")).toBe(true)
    expect((f.raw() as any).s1).toHaveLength(0)
  })
  test("损坏值 fail-open 为空表（不抛）", () => {
    const f = fake()
    f.store.set("x", ["not", "a", "db"])
    const repo = createAnnotationRepo(f.store)
    expect(repo.list("s1")).toEqual([])
  })
  test("add 生成唯一 id + createdAt", () => {
    const repo = createAnnotationRepo(fake().store)
    const x = repo.add({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "c" })
    const y = repo.add({ sessionID: "s1", rel: "a.ts", startLine: 2, endLine: 2, code: "y", comment: "d" })
    expect(x.id).not.toBe(y.id)
    expect(x.createdAt).toBeGreaterThan(0)
  })
})
