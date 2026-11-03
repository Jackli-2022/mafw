import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("preload exposes the pod namespace", () => {
  const api = read("src/preload/mafw-api.ts")
  const types = read("src/preload/mafw-types.ts")
  assert.ok(api.includes("pod: {"))
  assert.ok(api.includes('invoke("pod", "ensure"'))
  assert.ok(api.includes('invoke("pod", "lookup"'))
  assert.ok(api.includes('invoke("pod", "ensureLead"'))
  assert.ok(api.includes('invoke("pod", "readMemoryFile"'))
  assert.ok(api.includes('invoke("pod", "updateTask"'))
  assert.ok(api.includes('invoke("pod", "markRead"'))
  assert.ok(types.includes("pod: PodNamespace"))
})

test("preload wires the Task 18 collaboration methods", () => {
  const api = read("src/preload/mafw-api.ts")
  for (const method of [
    "techLead",
    "sendTechLeadMessage",
    "directionDecision",
    "probes",
    "createProbe",
    "rejectResult",
    "revisions",
  ]) {
    assert.ok(
      api.includes(`invoke("pod", "${method}"`),
      `preload is missing pod.${method}`,
    )
  }
  // Argument passthrough order matters for the IPC dispatcher.
  assert.ok(api.includes('invoke("pod", "techLead", podID, goalID, limit)'))
  assert.ok(api.includes('invoke("pod", "sendTechLeadMessage", podID, goalID, text, body)'))
  assert.ok(api.includes('invoke("pod", "directionDecision", podID, goalID, body)'))
  assert.ok(api.includes('invoke("pod", "probes", podID, goalID, filter)'))
  assert.ok(api.includes('invoke("pod", "createProbe", podID, goalID, body)'))
  assert.ok(api.includes('invoke("pod", "rejectResult", podID, goalID, feedback, body)'))
  assert.ok(api.includes('invoke("pod", "revisions", podID, goalID)'))
})
