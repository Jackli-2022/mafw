// B2（W5b）：composer 插入通道（按会话，模块单例）。
import { describe, expect, test } from "bun:test"
import { pushComposerInsert, takeComposerInsert, resetComposerInsertsForTest } from "./composer-insert"

describe("composer-insert", () => {
  test("push → take 按会话取回（FIFO）", () => {
    resetComposerInsertsForTest()
    pushComposerInsert("s1", "第一条")
    pushComposerInsert("s1", "第二条")
    expect(takeComposerInsert("s1")).toBe("第一条")
    expect(takeComposerInsert("s1")).toBe("第二条")
    expect(takeComposerInsert("s1")).toBeNull()
  })
  test("会话隔离：别的会话取不到", () => {
    resetComposerInsertsForTest()
    pushComposerInsert("s1", "给 s1")
    expect(takeComposerInsert("s2")).toBeNull()
    expect(takeComposerInsert("s1")).toBe("给 s1")
  })
  test("空 sid / 空文本忽略", () => {
    resetComposerInsertsForTest()
    pushComposerInsert("", "x")
    pushComposerInsert("s1", "  ")
    expect(takeComposerInsert("s1")).toBeNull()
  })
})
