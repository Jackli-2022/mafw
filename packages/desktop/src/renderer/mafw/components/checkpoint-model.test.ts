import { expect, test } from "bun:test"
import { buildCheckpoints, promptTextOf } from "./checkpoint-model"

const NOW = 1_700_000_000_000
const DAY = 86_400_000

test("only persisted user messages, newest first", () => {
  const out = buildCheckpoints([
    { id: "u1", role: "user", time: { created: NOW - 3000 } },
    { id: "a1", role: "assistant", time: { created: NOW - 2000 } },
    { id: "u2", role: "user", time: { created: NOW - 1000 } },
    { id: "user-123", role: "user", time: { created: NOW } },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["u2", "u1"])
})

test("prompt falls back text -> parts -> placeholder", () => {
  expect(promptTextOf({ id: "u1", text: " hello " }, {})).toBe("hello")
  expect(promptTextOf({ id: "u2" }, { u2: [{ type: "text", text: " A" }, { type: "tool" }, { type: "text", text: "B " }] })).toBe("A\nB")
  expect(promptTextOf({ id: "u3" }, {})).toBe("(无文本)")
})

test("30-day filter keeps null timestamps", () => {
  const out = buildCheckpoints([
    { id: "old", role: "user", time: { created: NOW - 31 * DAY } },
    { id: "recent", role: "user", time: { created: NOW - 1 * DAY } },
    { id: "unknown", role: "user" },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["recent", "unknown"])
})

test("copies summary.diffs and skips malformed entries", () => {
  const out = buildCheckpoints([
    { id: "u1", role: "user", time: { created: NOW }, summary: { diffs: [
      { file: "a.ts", additions: 2, deletions: 1, status: "modified", patch: "P" },
      { additions: 1 }, { file: "" }, null,
    ] } },
  ], {}, NOW)
  expect(out[0].files).toEqual([{ file: "a.ts", additions: 2, deletions: 1, status: "modified", patch: "P" }])
})

test("excludes local/optimistic/queued ids", () => {
  const out = buildCheckpoints([
    { id: "local-1", role: "user" }, { id: "queued-1", role: "user" }, { id: "ok", role: "user" },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["ok"])
})

test("empty session", () => {
  expect(buildCheckpoints([], {}, NOW)).toEqual([])
})
