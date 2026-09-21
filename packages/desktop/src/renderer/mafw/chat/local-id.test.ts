import { describe, expect, test } from "bun:test"
import { isLocalMessageId } from "./local-id"

describe("isLocalMessageId", () => {
  test("识别本地乐观 id 前缀", () => {
    expect(isLocalMessageId("user-1727000000000")).toBe(true)
    expect(isLocalMessageId("local-abc")).toBe(true)
    expect(isLocalMessageId("queued-1")).toBe(true)
  })
  test("拒绝真实 id", () => {
    expect(isLocalMessageId("msg_01J")).toBe(false)
    expect(isLocalMessageId("")).toBe(false)
    expect(isLocalMessageId("username-x")).toBe(false)
  })
})
