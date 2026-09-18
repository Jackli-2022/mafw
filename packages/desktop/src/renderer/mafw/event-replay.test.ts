// Golden replay: recorded /api/events broadcast frames (unwrapped shape) fed
// through the planner must produce the documented Rail cache action sequence.
import { test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { planSessionEvent, type RawSessionEvent } from "./session-events"

test("broadcast replay: lifecycle sequence produces invalidate→patch→remove", () => {
  const lines = readFileSync(join(__dirname, "fixtures/broadcast-session.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(l => JSON.parse(l) as RawSessionEvent)
  const actions = lines.map(planSessionEvent)
  expect(actions[0]).toEqual({ kind: "invalidate", directory: "/p" })
  expect(actions[1].kind).toBe("patch")
  if (actions[1].kind === "patch") expect(actions[1].patch.title).toBe("renamed")
  expect(actions[2]).toEqual({ kind: "remove", id: "s9" })
})

test("replay: hidden worker session produces none", () => {
  const action = planSessionEvent({
    type: "session.created",
    properties: { info: { id: "w1", title: "# Memory Indexing", directory: "/p" } },
  })
  expect(action.kind).toBe("none")
})
