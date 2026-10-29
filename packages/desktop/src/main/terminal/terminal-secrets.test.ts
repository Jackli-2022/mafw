import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTerminalSecrets } from "./terminal-secrets"

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from("enc:" + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
}

const file = () => join(mkdtempSync(join(tmpdir(), "mafw-sec-")), "secrets.json")

describe("terminal-secrets", () => {
  test("encrypts at rest and never writes plaintext", () => {
    const path = file()
    const store = createTerminalSecrets({ filePath: path, safeStorage: safe })
    store.set("h1", { password: "p@ss" })
    assert.equal(store.get("h1").password, "p@ss")
    assert.equal(store.has("h1").password, true)
    assert.ok(!readFileSync(path, "utf8").includes("p@ss"))
  })

  test("stores passphrase and clears independently", () => {
    const store = createTerminalSecrets({ filePath: file(), safeStorage: safe })
    store.set("h1", { password: "pw", passphrase: "pp" })
    store.set("h1", { clearPassword: true })
    assert.equal(store.get("h1").password, undefined)
    assert.equal(store.get("h1").passphrase, "pp")
    store.remove("h1")
    assert.deepEqual(store.get("h1"), {})
  })

  test("unavailable safeStorage disables saving", () => {
    const store = createTerminalSecrets({
      filePath: file(),
      safeStorage: { ...safe, isEncryptionAvailable: () => false },
    })
    assert.equal(store.available(), false)
    assert.throws(() => store.set("h1", { password: "x" }), /凭据存储不可用/)
  })

  test("Linux basic_text backend is treated as unavailable", () => {
    const store = createTerminalSecrets({
      filePath: file(),
      safeStorage: { ...safe, getSelectedStorageBackend: () => "basic_text" },
    })
    assert.equal(store.available(), false)
    assert.throws(() => store.set("h1", { password: "x" }), /凭据存储不可用/)
  })

  test("corrupt or undecryptable entries fail open as empty", () => {
    const path = file()
    const store = createTerminalSecrets({ filePath: path, safeStorage: safe })
    store.set("h1", { password: "x" })
    store.set("h2", { password: "y" })
    const broken = createTerminalSecrets({
      filePath: path,
      safeStorage: { ...safe, decryptString: () => { throw new Error("bad key") } },
    })
    assert.deepEqual(broken.get("h1"), {})
  })
})
