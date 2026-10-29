import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  applyTerminalEvent,
  localSessionId,
  nextActiveAfterClose,
  persistedTabs,
  reconnectLabel,
  statusLabel,
  statusTone,
  tabTitle,
} from "./terminal-model"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"

const local = {
  id: localSessionId("C:\\Work\\App", "win32"),
  kind: "local" as const,
  title: "本地 · App",
  directory: "C:\\Work\\App",
  status: "connected" as const,
}

describe("terminal-model", () => {
  test("local session id + title + status", () => {
    assert.equal(local.id, "local:c:/work/app")
    assert.equal(tabTitle(local), "本地 · App")
    assert.equal(statusTone(local), "ok")
    assert.equal(statusLabel({ ...local, status: "reconnecting", reconnectAttempt: 2 }), "重连中 2/5")
    assert.equal(reconnectLabel({ ...local, status: "reconnecting", reconnectInMs: 3000, reconnectAttempt: 2 }), "3 秒后重试（2/5）")
  })

  test("status tone and label cover ssh states", () => {
    const ssh: TerminalSessionInfo = {
      id: "ssh:1",
      kind: "ssh",
      title: "prod-01",
      hostId: "h1",
      status: "connecting",
    }
    assert.equal(statusTone(ssh), "warn")
    assert.equal(statusLabel(ssh), "连接中")
    assert.equal(statusTone({ ...ssh, status: "connected" }), "ok")
    assert.equal(statusTone({ ...ssh, status: "error" }), "bad")
    assert.equal(statusTone({ ...ssh, status: "closed" }), "idle")
    assert.equal(statusLabel({ ...ssh, status: "disconnected" }), "已断开")
    assert.equal(statusLabel({ ...ssh, status: "error" }), "连接失败")
  })

  test("nextActiveAfterClose picks neighbor and persistedTabs keeps identity", () => {
    const tabs = [local, { ...local, id: "ssh:1", kind: "ssh" as const, title: "prod" }]
    assert.equal(nextActiveAfterClose(tabs, "ssh:1", "ssh:1"), local.id)
    assert.equal(nextActiveAfterClose(tabs, local.id, "ssh:1"), local.id)
    const saved = persistedTabs(tabs, "ssh:1")
    assert.equal(saved.activeId, "ssh:1")
    assert.deepEqual(saved.tabs.map((t) => t.id), [local.id, "ssh:1"])
  })

  test("applyTerminalEvent updates status without dropping identity", () => {
    const s: TerminalSessionInfo = {
      id: "ssh:1",
      kind: "ssh",
      title: "prod-01",
      hostId: "h1",
      status: "connecting",
    }
    const next = applyTerminalEvent(
      { sessions: [s] },
      { type: "status", sessionId: "ssh:1", status: "connected", connectedAt: 123 },
    )
    assert.equal(next.sessions[0].status, "connected")
    assert.equal(next.sessions[0].hostId, "h1")
    assert.equal(next.sessions[0].connectedAt, 123)
  })
})
