import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { nextConnState, externalTerminalCommand, dirKey } from "./terminal-core"

describe("terminal-core", () => {
  test("nextConnState：attachOk→live；wsClosed→closed；ptyGone→gone；probeFail→unavailable；retry 从 closed/gone 回 probing", () => {
    assert.equal(nextConnState("probing", "attachOk"), "live")
    assert.equal(nextConnState("live", "wsClosed"), "closed")
    assert.equal(nextConnState("live", "ptyGone"), "gone")
    assert.equal(nextConnState("probing", "probeFail"), "unavailable")
    assert.equal(nextConnState("closed", "retry"), "probing")
    assert.equal(nextConnState("gone", "retry"), "probing")
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
})
