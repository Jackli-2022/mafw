import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { redactError, redactSshConfig } from "./redact"

describe("redact", () => {
  test("redacts secrets recursively without touching safe fields", () => {
    const input = {
      host: "10.0.0.12",
      password: "p@ss",
      nested: { passphrase: "pp", privateKey: "PEM", user: "deploy" },
      list: [{ password: "x" }],
    }
    assert.deepEqual(redactSshConfig(input), {
      host: "10.0.0.12",
      password: "[REDACTED]",
      nested: { passphrase: "[REDACTED]", privateKey: "[REDACTED]", user: "deploy" },
      list: [{ password: "[REDACTED]" }],
    })
  })

  test("redactError keeps message and code only", () => {
    const err: any = new Error("auth failed")
    err.code = "AUTH"
    assert.deepEqual(redactError(err), { message: "auth failed", code: "AUTH" })
    assert.deepEqual(redactError("boom"), { message: "boom" })
  })
})
