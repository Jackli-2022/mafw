import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { transcriptTurns } from "./pod-transcript"

describe("transcriptTurns", () => {
  test("renders flat content snapshots", () => {
    const turns = transcriptTurns({
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "tool", tool: "bash" }] },
      ],
    })
    assert.deepEqual(turns, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ])
  })

  test("ignores legacy {info, parts} snapshots (no client-side wire expansion)", () => {
    assert.deepEqual(
      transcriptTurns({ messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "legacy" }] }] }),
      [],
    )
  })

  test("renders {role, content} snapshots and ignores empty/unavailable", () => {
    assert.deepEqual(
      transcriptTurns({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: [{ type: "text", text: "b" }] },
        ],
      }),
      [{ role: "user", text: "a" }, { role: "assistant", text: "b" }],
    )
    assert.deepEqual(transcriptTurns({ messages: [], unavailable: true }), [])
    assert.deepEqual(transcriptTurns(null), [])
  })

  test("joins multiple text parts and maps unknown roles to other", () => {
    assert.deepEqual(
      transcriptTurns([{ role: "system", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }]),
      [{ role: "other", text: "a\nb" }],
    )
  })
})
