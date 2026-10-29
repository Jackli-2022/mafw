import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSshHostStore } from "./ssh-host-store"
import type { SshHostProfileInput } from "../../shared/ssh-host"

const base: SshHostProfileInput = {
  name: "prod-01",
  group: "生产",
  host: "10.0.0.12",
  port: 22,
  username: "deploy",
  auth: "password",
  autoReconnect: true,
  keepaliveSeconds: 15,
}

const file = () => join(mkdtempSync(join(tmpdir(), "mafw-hosts-")), "hosts.json")

describe("ssh-host-store", () => {
  test("save/list/get/remove", () => {
    const store = createSshHostStore({ filePath: file(), now: () => 100, id: () => "h1" })
    const saved = store.save(base)
    assert.equal(saved.id, "h1")
    assert.equal(saved.createdAt, 100)
    assert.equal(saved.updatedAt, 100)
    assert.equal(store.list().length, 1)
    assert.equal(store.get("h1")?.host, "10.0.0.12")
    store.remove("h1")
    assert.deepEqual(store.list(), [])
  })

  test("edit preserves id/createdAt and updates updatedAt", () => {
    let t = 100
    const store = createSshHostStore({ filePath: file(), now: () => t })
    const saved = store.save(base)
    t = 200
    const edited = store.save({ ...base, id: saved.id, name: "prod-02" }, store.list())
    assert.equal(edited.id, saved.id)
    assert.equal(edited.createdAt, 100)
    assert.equal(edited.updatedAt, 200)
    assert.equal(edited.name, "prod-02")
  })

  test("rejects invalid profile and corrupt file fails open", () => {
    const path = file()
    const store = createSshHostStore({ filePath: path })
    assert.throws(() => store.save({ ...base, host: "" }), /主机不能为空/)
    writeFileSync(path, "not json", "utf8")
    assert.deepEqual(store.list(), [])
  })

  test("never stores secret-like fields from the profile", () => {
    const path = file()
    const store = createSshHostStore({ filePath: path })
    store.save({ ...base, password: "x" } as any)
    assert.ok(!readFileSync(path, "utf8").includes('"x"'))
  })
})
