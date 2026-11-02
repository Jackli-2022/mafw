/**
 * Task 18: collaboration SDK surface (direct discussion Goal / Tech Lead / direction /
 * probes / reject / revisions). Path + body contract only — the gateway side is covered
 * by `gateway/tests/integration/pod-collaboration-routes.test.ts`.
 */
import { test, expect, mock, beforeEach } from "bun:test"
import { MafwClient } from "./client"

let fetchMock: ReturnType<typeof mock>

beforeEach(() => {
  fetchMock = mock()
  globalThis.fetch = fetchMock as any
})

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(data) } as Response)
}

function lastCall() {
  return fetchMock.mock.calls.at(-1) as any[]
}

test("pod.createGoal posts the direct discussion Goal and reports discussing", async () => {
  fetchMock.mockResolvedValue(okJson({
    podId: "pod_1",
    goalId: "g1",
    status: "discussing",
    revision: 1,
    stage: "discussing",
    sessionID: "ses_tech",
    queueReason: null,
    goal: { goalId: "g1" },
  }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.pod.createGoal("pod_1", { title: "Loop", objective: "实现" })
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals")
  expect(lastCall()[1]).toMatchObject({ method: "POST" })
  expect(JSON.parse(lastCall()[1].body)).toMatchObject({ title: "Loop", objective: "实现" })
  expect(res.status).toBe("discussing")
  expect(res.revision).toBe(1)

  // The entry point travels with the request so the gateway persists the real source.
  await c.pod.createGoal("pod_1", { title: "Loop", source: "tui" })
  expect(JSON.parse(lastCall()[1].body)).toMatchObject({ source: "tui" })
})

test("pod.techLead hits the discussion route with an optional limit", async () => {
  fetchMock.mockResolvedValue(okJson({ goalId: "g1", revision: 1, sessionID: "ses_tech", messages: [] }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.pod.techLead("pod_1", "g1", 20)
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/tech-lead?limit=20")
  expect(res.sessionID).toBe("ses_tech")

  await c.pod.techLead("pod_1", "g1")
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/tech-lead")
})

test("pod.sendTechLeadMessage posts text (and actor) to the messages route", async () => {
  fetchMock.mockResolvedValue(okJson({ goalId: "g1", revision: 1, sessionID: "ses_tech", text: "ok" }))
  const c = new MafwClient("http://gw:3000")
  await c.pod.sendTechLeadMessage("pod_1", "g1", "讨论方向", { actorSessionID: "ses_lead" })
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/tech-lead/messages")
  expect(lastCall()[1]).toMatchObject({ method: "POST" })
  expect(JSON.parse(lastCall()[1].body)).toEqual({ text: "讨论方向", actorSessionID: "ses_lead" })
})

test("pod.directionDecision posts the decision body", async () => {
  fetchMock.mockResolvedValue(okJson({ goalId: "g1", revision: 1, directionStatus: "decided" }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.pod.directionDecision("pod_1", "g1", {
    mode: "decided",
    userWords: "先做界面",
  })
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/direction-decision")
  expect(lastCall()[1]).toMatchObject({ method: "POST" })
  expect(JSON.parse(lastCall()[1].body)).toMatchObject({ mode: "decided", userWords: "先做界面" })
  expect(res.directionStatus).toBe("decided")
})

test("pod.probes lists with filters and createProbe wraps batches", async () => {
  const c = new MafwClient("http://gw:3000")
  fetchMock.mockResolvedValue(okJson({ items: [] }))

  await c.pod.probes("pod_1", "g1", { revision: 2, status: "queued" })
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/probes?revision=2&status=queued")
  await c.pod.probes("pod_1", "g1")
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/probes")

  const probe = {
    question: "q",
    hypothesis: "h",
    scope: { paths: ["src"], commandClasses: ["test"], network: false, credentials: [] },
    budget: { maxMinutes: 5, maxUsd: 1 },
    evidenceRequired: ["npm test"],
  }
  await c.pod.createProbe("pod_1", "g1", probe)
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/probes")
  expect(JSON.parse(lastCall()[1].body)).toMatchObject({ question: "q" })

  await c.pod.createProbe("pod_1", "g1", [probe, { ...probe, question: "q2" }])
  expect(JSON.parse(lastCall()[1].body).probes).toHaveLength(2)
})

test("pod.rejectResult posts feedback and returns the next revision", async () => {
  fetchMock.mockResolvedValue(okJson({ podId: "pod_1", goalId: "g1", revision: 2, status: "discussing" }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.pod.rejectResult("pod_1", "g1", "打回")
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/reject")
  expect(lastCall()[1]).toMatchObject({ method: "POST" })
  expect(JSON.parse(lastCall()[1].body)).toEqual({ feedback: "打回" })
  expect(res.revision).toBe(2)
})

test("pod.revisions reads the append-only revision history", async () => {
  fetchMock.mockResolvedValue(okJson({ items: [{ revision: 1 }, { revision: 2 }] }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.pod.revisions("pod_1", "g1")
  expect(lastCall()[0]).toBe("http://gw:3000/api/pods/pod_1/goals/g1/revisions")
  expect(res.items).toHaveLength(2)
})
