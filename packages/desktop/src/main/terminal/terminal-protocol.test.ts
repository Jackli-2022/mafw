import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  MAFW_TERMINAL_PROTOCOL,
  encodeTerminalFrame,
  decodeTerminalFrame,
} from "./terminal-protocol"

describe("MAFW terminal frame codec", () => {
  test("protocol id is the neutral one (no native PTY vocabulary)", () => {
    assert.equal(MAFW_TERMINAL_PROTOCOL, "mafw-terminal/1")
  })

  test("roundtrips every frame kind", () => {
    const frames = [
      { v: 1 as const, type: "input" as const, data: "echo hi\r" },
      { v: 1 as const, type: "resize" as const, cols: 100, rows: 30 },
      { v: 1 as const, type: "output" as const, data: "hi\r\n" },
      { v: 1 as const, type: "meta" as const, event: "cursor", payload: { cursor: 7 } },
      { v: 1 as const, type: "close" as const, code: 1000, reason: "done" },
    ]
    for (const frame of frames) {
      assert.deepEqual(decodeTerminalFrame(encodeTerminalFrame(frame)), frame)
    }
  })

  test("decodes Uint8Array / ArrayBuffer / Buffer payloads", () => {
    const text = encodeTerminalFrame({ v: 1, type: "output", data: "x" })
    assert.deepEqual(decodeTerminalFrame(new TextEncoder().encode(text)), { v: 1, type: "output", data: "x" })
    const encoded = new TextEncoder().encode(text)
    assert.deepEqual(
      decodeTerminalFrame(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)),
      { v: 1, type: "output", data: "x" },
    )
    assert.deepEqual(decodeTerminalFrame(Buffer.from(text, "utf8")), { v: 1, type: "output", data: "x" })
  })

  test("rejects foreign, malformed and version-mismatched frames (fail closed)", () => {
    assert.equal(decodeTerminalFrame("not json"), null)
    assert.equal(decodeTerminalFrame(JSON.stringify({ type: "output", data: "x" })), null)
    assert.equal(decodeTerminalFrame(JSON.stringify({ v: 2, type: "output", data: "x" })), null)
    assert.equal(decodeTerminalFrame(JSON.stringify({ v: 1, type: "output" })), null)
    assert.equal(decodeTerminalFrame(JSON.stringify({ v: 1, type: "resize", cols: 0, rows: 10 })), null)
    assert.equal(decodeTerminalFrame({}), null)
    assert.equal(decodeTerminalFrame(null), null)
  })

  test("close frame defaults code to 1000 and drops non-string reasons", () => {
    assert.deepEqual(decodeTerminalFrame(JSON.stringify({ v: 1, type: "close" })), { v: 1, type: "close", code: 1000 })
  })
})
