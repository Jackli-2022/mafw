import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createJumpSock, type JumpClientLike } from "./ssh-jump"
import type { SshHostProfile } from "../../shared/ssh-host"

const jump: SshHostProfile = {
  id: "bastion",
  name: "bastion",
  group: "生产",
  host: "10.0.0.8",
  port: 22,
  username: "ops",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
  createdAt: 1,
  updatedAt: 1,
}

class FakeStream extends EventEmitter {
  closed = false
  close() { this.closed = true; this.emit("close") }
}

class FakeJumpClient extends EventEmitter implements JumpClientLike {
  forwardCalls: any[] = []
  ended = false
  forwardStream = new FakeStream()
  connectCfg: any
  connect(cfg: any) { this.connectCfg = cfg }
  forwardOut(srcIP: string, srcPort: number, dstIP: string, dstPort: number, cb: any) {
    this.forwardCalls.push([srcIP, srcPort, dstIP, dstPort])
    cb(null, this.forwardStream)
  }
  end() { this.ended = true }
}

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const deps = (client: FakeJumpClient) => ({
  sessionId: "ssh:1",
  target: { host: "10.0.0.12", port: 22 },
  jump: { profile: jump, secret: { password: "x" } },
  knownHosts: {
    get: () => null as any,
    put: () => {},
    replace: () => {},
  },
  requestHostKey: async () => "trust" as const,
  createClient: () => client,
  timeoutMs: 100,
})

describe("ssh-jump", () => {
  test("connects bastion then forwards to target", async () => {
    const client = new FakeJumpClient()
    const p = createJumpSock(deps(client))
    client.emit("ready")
    await tick()
    const res = await p
    assert.deepEqual(client.forwardCalls, [["127.0.0.1", 0, "10.0.0.12", 22]])
    assert.equal(res.sock, client.forwardStream)
  })

  test("close ends the bastion and stream", async () => {
    const client = new FakeJumpClient()
    const p = createJumpSock(deps(client))
    client.emit("ready")
    await tick()
    const res = await p
    res.close()
    assert.equal(client.forwardStream.closed, true)
    assert.equal(client.ended, true)
  })

  test("bastion failure rejects and ends the client", async () => {
    const client = new FakeJumpClient()
    const p = createJumpSock(deps(client))
    client.emit("error", new Error("auth failed"))
    await assert.rejects(p, /auth failed/)
    assert.equal(client.ended, true)
  })
})
