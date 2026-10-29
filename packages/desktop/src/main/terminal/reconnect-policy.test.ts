import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { canAutoReconnect, reconnectDelay } from "./reconnect-policy"
import type { SshHostProfile } from "../../shared/ssh-host"

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

describe("reconnect-policy", () => {
  test("delays 1/2/4/8/16s and stops after 5", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(reconnectDelay), [1000, 2000, 4000, 8000, 16000])
    assert.equal(reconnectDelay(0), null)
    assert.equal(reconnectDelay(6), null)
  })

  test("auto reconnect requires the toggle and non-interactive credentials", () => {
    assert.equal(canAutoReconnect({ profile: base, hasPassword: true, hasPassphrase: false, hasKey: false, agentAvailable: false }), true)
    assert.equal(canAutoReconnect({ profile: { ...base, autoReconnect: false }, hasPassword: true, hasPassphrase: false, hasKey: false, agentAvailable: false }), false)
    assert.equal(canAutoReconnect({ profile: base, hasPassword: false, hasPassphrase: false, hasKey: false, agentAvailable: false }), false)
    assert.equal(canAutoReconnect({ profile: { ...base, auth: "key" }, hasPassword: false, hasPassphrase: true, hasKey: true, agentAvailable: false }), true)
    assert.equal(canAutoReconnect({ profile: { ...base, auth: "agent" }, hasPassword: false, hasPassphrase: false, hasKey: false, agentAvailable: true }), true)
    assert.equal(canAutoReconnect({ profile: { ...base, auth: "agent" }, hasPassword: false, hasPassphrase: false, hasKey: false, agentAvailable: false }), false)
  })
})
