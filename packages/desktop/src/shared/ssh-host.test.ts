import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { sshHostKey, validateSshHostProfile, type SshHostProfileInput } from "./ssh-host"

const base: SshHostProfileInput = {
  name: "prod",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
}

describe("validateSshHostProfile", () => {
  test("rejects empty host / bad port / empty user", () => {
    assert.equal(validateSshHostProfile({ ...base, host: "" }, { hosts: [] }).ok, false)
    assert.equal(validateSshHostProfile({ ...base, port: 0 }, { hosts: [] }).ok, false)
    assert.equal(validateSshHostProfile({ ...base, port: 70000 }, { hosts: [] }).ok, false)
    assert.equal(validateSshHostProfile({ ...base, username: " " }, { hosts: [] }).ok, false)
  })

  test("rejects self jump and jump-host-with-own-jump", () => {
    const hosts = [{ id: "a", jumpHostId: null }, { id: "b", jumpHostId: "a" }]
    assert.equal(validateSshHostProfile({ ...base, id: "a", jumpHostId: "a" }, { hosts }).ok, false)
    assert.equal(validateSshHostProfile({ ...base, jumpHostId: "b" }, { hosts }).ok, false)
  })

  test("accepts valid profile and trims text fields", () => {
    const result = validateSshHostProfile(
      { ...base, name: "  prod-01  ", host: " example.com ", username: " deploy " },
      { hosts: [] },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.name, "prod-01")
    assert.equal(result.value.host, "example.com")
    assert.equal(result.value.username, "deploy")
  })

  test("key auth requires a private key path", () => {
    const result = validateSshHostProfile({ ...base, auth: "key" }, { hosts: [] })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.errors.join(" "), /私钥/)
  })
})

test("sshHostKey normalizes port", () => {
  assert.equal(sshHostKey("10.0.0.12", 22), "10.0.0.12:22")
})
