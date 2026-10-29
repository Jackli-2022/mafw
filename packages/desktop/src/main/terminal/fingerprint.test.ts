import { test } from "node:test"
import assert from "node:assert/strict"
import { fingerprintOf } from "./fingerprint"

test("SHA256 fingerprint format", () => {
  assert.equal(fingerprintOf(Buffer.from("abc")), "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=")
})
