import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { addMark, clearMarks, markResponded, marksFor, noteTurnActivity, resetMarks } from "./annotation-marks"

describe("annotation-marks（批注反馈态）", () => {
  test("按 sessionID 隔离 + 按 rel 过滤", () => {
    resetMarks()
    addMark("s1", "a.md", { kind: "quote", quote: "x" })
    addMark("s1", "b.png", { kind: "region", x: 0, y: 0, w: 0.1, h: 0.1 })
    addMark("s2", "a.md")
    assert.equal(marksFor("s1", "a.md").length, 1)
    assert.equal(marksFor("s1", "b.png").length, 1)
    assert.equal(marksFor("s2", "a.md").length, 1)
    assert.equal(marksFor("s2", "b.png").length, 0)
  })

  test("markResponded 只翻本会话 pending", () => {
    resetMarks()
    addMark("s1", "a.md")
    addMark("s2", "a.md")
    markResponded("s1")
    assert.equal(marksFor("s1", "a.md")[0].status, "responded")
    assert.equal(marksFor("s2", "a.md")[0].status, "pending")
  })

  test("clearMarks / resetMarks", () => {
    resetMarks()
    addMark("s1", "a.md")
    clearMarks("s1")
    assert.equal(marksFor("s1", "a.md").length, 0)
  })
})

describe("回合归属（I4）", () => {
  test("回合开始前的 mark 才被本次完成翻转", () => {
    resetMarks()
    addMark("s1", "a.md")            // 空闲期创建（属于下一个回合）
    noteTurnActivity("s1")           // 回合开始
    addMark("s1", "b.md")            // 回合进行中创建（属于下一个回合）
    markResponded("s1")
    assert.equal(marksFor("s1", "a.md")[0].status, "responded")
    assert.equal(marksFor("s1", "b.md")[0].status, "pending")
    noteTurnActivity("s1")
    markResponded("s1")
    assert.equal(marksFor("s1", "b.md")[0].status, "responded")
  })
})

describe("上限（M2）", () => {
  test("每会话最多保留 50 条（丢最旧）", () => {
    resetMarks()
    for (let i = 0; i < 60; i++) addMark("s1", "a.md")
    const marks = marksFor("s1", "a.md")
    assert.equal(marks.length, 50)
    assert.notEqual(marks[0].id, "")
  })
})
