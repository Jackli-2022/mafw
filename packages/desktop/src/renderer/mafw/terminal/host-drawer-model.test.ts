import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { groupHosts } from "./host-drawer-model"
import type { SshHostProfile } from "../../../shared/ssh-host"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"

const base: SshHostProfile = {
  id: "h1",
  name: "prod-01",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
  createdAt: 1,
  updatedAt: 1,
}

describe("groupHosts", () => {
  test("groups, filters and counts sessions", () => {
    const hosts = [
      { ...base, id: "h1", group: "生产", name: "prod-01" },
      { ...base, id: "h2", group: "生产", name: "prod-02" },
      { ...base, id: "h3", group: "测试", name: "db-02" },
    ]
    const sessions = [
      { id: "ssh:1", kind: "ssh", hostId: "h1", title: "prod-01", status: "connected" },
      { id: "ssh:2", kind: "ssh", hostId: "h1", title: "prod-01", status: "reconnecting" },
    ] as TerminalSessionInfo[]
    const out = groupHosts(hosts, sessions, "")
    assert.equal(out[0].group, "生产")
    assert.equal(out[0].hosts.find((h) => h.host.id === "h1")!.sessionCount, 2)
    assert.equal(out[0].hosts.find((h) => h.host.id === "h1")!.status, "connected")
    assert.equal(groupHosts(hosts, sessions, "db").length, 1)
  })

  test("status priority connected > reconnecting > disconnected and search fields", () => {
    const hosts = [
      { ...base, id: "h1", group: "生产", name: "prod-01" },
      { ...base, id: "h2", group: "生产", name: "prod-02", host: "db.internal" },
    ]
    const sessions = [
      { id: "ssh:1", kind: "ssh", hostId: "h1", title: "prod-01", status: "reconnecting" },
      { id: "ssh:2", kind: "ssh", hostId: "h1", title: "prod-01", status: "disconnected" },
    ] as TerminalSessionInfo[]
    const out = groupHosts(hosts, sessions, "")
    const h1 = out[0].hosts.find((h) => h.host.id === "h1")!
    assert.equal(h1.status, "reconnecting")
    assert.equal(out[0].hosts.find((h) => h.host.id === "h2")!.status, "disconnected")
    assert.equal(groupHosts(hosts, sessions, "DB.INTERNAL")[0].hosts.length, 1)
    assert.equal(groupHosts(hosts, sessions, "deploy")[0].hosts.length, 2)
  })
})
