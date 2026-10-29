import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createKnownHostsStore } from "./known-hosts-store"

const file = () => join(mkdtempSync(join(tmpdir(), "mafw-kh-")), "known-hosts.json")

describe("known-hosts-store", () => {
  test("put/get/replace by host:port", () => {
    let t = 100
    const store = createKnownHostsStore({ filePath: file(), now: () => t })
    store.put({ host: "10.0.0.12", port: 22, keyType: "ssh-ed25519", publicKey: "AAA", fingerprint: "SHA256:x", addedAt: 1, lastSeenAt: 1 })
    assert.equal(store.get("10.0.0.12", 22)?.publicKey, "AAA")
    t = 200
    store.replace({ ...store.get("10.0.0.12", 22)!, publicKey: "BBB" })
    const entry = store.get("10.0.0.12", 22)!
    assert.equal(entry.publicKey, "BBB")
    assert.equal(entry.addedAt, 1)
    assert.equal(entry.lastSeenAt, 200)
  })

  test("remove and corrupt file fail open", () => {
    const path = file()
    const store = createKnownHostsStore({ filePath: path })
    store.put({ host: "h", port: 22, keyType: "ssh-ed25519", publicKey: "A", fingerprint: "f", addedAt: 1, lastSeenAt: 1 })
    store.remove("h", 22)
    assert.equal(store.get("h", 22), null)
    writeFileSync(path, "{", "utf8")
    assert.deepEqual(store.list(), [])
  })
})
