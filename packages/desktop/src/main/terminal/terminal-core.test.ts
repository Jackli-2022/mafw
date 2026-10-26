import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { unwrapData, pickActivePty, parseMetaFrame, nextConnState, encodeInput } from "./terminal-core"

describe("terminal-core", () => {
  test("unwrapData 解 {location,data} 信封，裸对象原样", () => {
    assert.equal(unwrapData({ location: {}, data: { id: "p1" } }).id, "p1")
    assert.equal(unwrapData({ id: "p2" }).id, "p2")
  })
  test("pickActivePty 取最后一个 running；全死返回 null", () => {
    const l = [{ id: "a", status: "exited" }, { id: "b", status: "running" }, { id: "c", status: "running" }]
    assert.equal(pickActivePty(l)?.id, "c")
    assert.equal(pickActivePty([{ id: "a", status: "exited" }]), null)
    assert.equal(pickActivePty([]), null)
  })
  test("parseMetaFrame：0x00 前缀二进制 → cursor；文本/普通二进制 → null", () => {
    const payload = new TextEncoder().encode('\0{"cursor":1234}')
    assert.deepEqual(parseMetaFrame(payload.buffer), { cursor: 1234 })
    assert.equal(parseMetaFrame("hello"), null)
    assert.equal(parseMetaFrame(new TextEncoder().encode("plain").buffer), null)
  })
  test("nextConnState：attachOk→live；wsClosed→closed；ptyGone→gone；probeFail→unavailable；retry 从 closed/gone 回 probing", () => {
    assert.equal(nextConnState("probing", "attachOk"), "live")
    assert.equal(nextConnState("live", "wsClosed"), "closed")
    assert.equal(nextConnState("live", "ptyGone"), "gone")
    assert.equal(nextConnState("probing", "probeFail"), "unavailable")
    assert.equal(nextConnState("closed", "retry"), "probing")
    assert.equal(nextConnState("gone", "retry"), "probing")
  })
  test("encodeInput 恒等透传（\\r 不改 \\n）", () => {
    assert.equal(encodeInput("echo hi\r"), "echo hi\r")
  })
})
