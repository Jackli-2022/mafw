import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildSshConnectConfig, createHostVerifier, type SshRuntimeSecret } from "./ssh-connect"
import type { KnownHostEntry, SshHostProfile } from "../../shared/ssh-host"

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

const entry: KnownHostEntry = {
  host: "10.0.0.12",
  port: 22,
  keyType: "ssh-ed25519",
  publicKey: "old",
  fingerprint: "SHA256:old",
  addedAt: 1,
  lastSeenAt: 1,
}

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe("ssh-connect", () => {
  test("config carries auth/keepalive/timeouts", () => {
    const cfg = buildSshConnectConfig({ profile: base, secret: { password: "x" }, hostVerifier: () => {} })
    assert.equal(cfg.host, "10.0.0.12")
    assert.equal(cfg.port, 22)
    assert.equal(cfg.username, "deploy")
    assert.equal(cfg.password, "x")
    assert.equal(cfg.readyTimeout, 120_000)
    assert.equal(cfg.keepaliveInterval, 15_000)
    assert.equal(cfg.keepaliveCountMax, 3)
    assert.equal(cfg.tryKeyboard, true)
  })

  test("key and agent auth are passed through", () => {
    const keyCfg = buildSshConnectConfig({
      profile: { ...base, auth: "key", privateKeyPath: "C:\\keys\\id" },
      secret: { privateKey: "PEM", passphrase: "p" },
      hostVerifier: () => {},
    })
    assert.equal(keyCfg.privateKey, "PEM")
    assert.equal(keyCfg.passphrase, "p")
    const agentCfg = buildSshConnectConfig({
      profile: { ...base, auth: "agent" },
      secret: {},
      hostVerifier: () => {},
      agent: "\\\\.\\pipe\\openssh-ssh-agent",
    })
    assert.equal(agentCfg.agent, "\\\\.\\pipe\\openssh-ssh-agent")
  })

  test("new key asks and saves", async () => {
    const saved: KnownHostEntry[] = []
    const verifier = createHostVerifier({
      sessionId: "ssh:1",
      host: "10.0.0.12",
      port: 22,
      knownHosts: { get: () => null, put: (e) => saved.push(e), replace: () => {} },
      request: async () => "trust-and-save",
      keyTypeOf: () => "ssh-ed25519",
    })
    let ok = false
    verifier(Buffer.from("key"), (v) => { ok = v })
    await tick()
    assert.equal(ok, true)
    assert.equal(saved[0].fingerprint.startsWith("SHA256:"), true)
    assert.equal(saved[0].keyType, "ssh-ed25519")
  })

  test("matching key proceeds without prompting", () => {
    let asked = false
    const match = { ...entry, publicKey: Buffer.from("same").toString("base64") }
    const verifier = createHostVerifier({
      sessionId: "ssh:1",
      host: "10.0.0.12",
      port: 22,
      knownHosts: { get: () => match, put: () => {}, replace: () => {} },
      request: async () => { asked = true; return "reject" },
      keyTypeOf: () => "ssh-ed25519",
    })
    let ok = false
    verifier(Buffer.from("same"), (v) => { ok = v })
    assert.equal(ok, true)
    assert.equal(asked, false)
  })

  test("changed key blocks by default and replace updates store", async () => {
    let replaced: KnownHostEntry | null = null
    const verifier = createHostVerifier({
      sessionId: "ssh:1",
      host: "10.0.0.12",
      port: 22,
      knownHosts: {
        get: () => entry,
        put: () => {},
        replace: (e) => { replaced = e },
      },
      request: async () => "replace",
      keyTypeOf: () => "ssh-ed25519",
    })
    let ok = false
    verifier(Buffer.from("new-key"), (v) => { ok = v })
    await tick()
    assert.equal(ok, true)
    assert.equal(replaced?.host, "10.0.0.12")
    assert.notEqual(replaced?.publicKey, "old")
  })

  test("changed key reject stops the handshake", async () => {
    const verifier = createHostVerifier({
      sessionId: "ssh:1",
      host: "10.0.0.12",
      port: 22,
      knownHosts: { get: () => entry, put: () => {}, replace: () => {} },
      request: async () => "reject",
      keyTypeOf: () => "ssh-ed25519",
    })
    let ok = true
    verifier(Buffer.from("new-key"), (v) => { ok = v })
    await tick()
    assert.equal(ok, false)
  })

  test("host key prompt times out to reject", async () => {
    const verifier = createHostVerifier({
      sessionId: "ssh:1",
      host: "10.0.0.12",
      port: 22,
      knownHosts: { get: () => null, put: () => {}, replace: () => {} },
      request: () => new Promise(() => {}),
      timeoutMs: 10,
      keyTypeOf: () => "ssh-ed25519",
    })
    let ok = true
    verifier(Buffer.from("key"), (v) => { ok = v })
    await new Promise((r) => setTimeout(r, 25))
    assert.equal(ok, false)
  })
})
