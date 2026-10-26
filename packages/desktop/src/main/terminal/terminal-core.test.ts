import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { unwrapData, pickActivePty, parseMetaFrame, nextConnState, encodeInput, externalTerminalCommand, dirKey, isMetaFrame } from "./terminal-core"

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
  test("externalTerminalCommand：win32 优先 wt，回退 cmd start；darwin open -a Terminal；linux x-terminal-emulator", () => {
    const win = externalTerminalCommand("C:\\p", "win32")
    assert.equal(win.cmd, "wt.exe")
    assert.deepEqual(win.args, ["-d", "C:\\p"])
    assert.equal(win.fallback?.cmd, "cmd.exe")
    assert.deepEqual(win.fallback?.args, ["/c", "start", "cmd"])
    assert.equal(win.fallback?.cwd, "C:\\p")

    const mac = externalTerminalCommand("/Users/x/p", "darwin")
    assert.equal(mac.cmd, "open")
    assert.deepEqual(mac.args, ["-a", "Terminal", "/Users/x/p"])

    const linux = externalTerminalCommand("/home/x/p", "linux")
    assert.equal(linux.cmd, "x-terminal-emulator")
    assert.equal(linux.cwd, "/home/x/p")
  })
  test("dirKey：win32 分隔符归一+小写；darwin 折大小写；linux 原样（大小写敏感）", () => {
    assert.equal(dirKey("C:\\Proj\\App", "win32"), "c:/proj/app")
    assert.equal(dirKey("/Proj/App", "darwin"), "/proj/app")
    assert.equal(dirKey("/Proj/App", "linux"), "/Proj/App")
  })
  test("isMetaFrame：0x00 前缀（含非法 JSON）为 meta；普通二进制/文本不是", () => {
    const bad = new Uint8Array([0, ...new TextEncoder().encode("{bad")]).buffer
    assert.equal(isMetaFrame(bad), true)
    assert.equal(isMetaFrame(new TextEncoder().encode("plain").buffer), false)
    assert.equal(isMetaFrame("text"), false)
  })
})
