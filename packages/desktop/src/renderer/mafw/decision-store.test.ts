import { test } from "node:test"
import assert from "node:assert/strict"
import { createDecisionStore } from "./decision-store"

function attention(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1:plan_approval:r1",
    goalId: "g1",
    revision: 1,
    kind: "plan_approval",
    priority: 100,
    coalesceKey: "g1:plan_approval:r1",
    title: "工作台重构",
    action: { type: "open_plan_review", goalId: "g1" },
    ...overrides,
  } as any
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "dec_1",
    projectDir: "C:/repo",
    goalId: "g1",
    revision: 1,
    kind: "plan",
    status: "draft",
    question: "采用哪个方案？",
    options: [],
    evidence: [],
    rationale: null,
    consequences: null,
    reviewAt: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    history: [],
    ...overrides,
  } as any
}

test("decision store exposes attention items and counts", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({
        items: [
          attention(),
          attention({
            id: "g1:review_item:r1:item_1",
            kind: "review_item",
            priority: 75,
            action: { type: "open_review_item", goalId: "g1", itemId: "item_1", rel: "src/a.ts" },
          }),
        ],
      }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.items().length, 2)
  assert.equal(store.counts().needsYou, 2)
  assert.ok(store.revision() >= 1)
})

test("decision store keeps the last list on failure", async () => {
  let calls = 0
  const store = createDecisionStore({
    api: {
      attention: async () => {
        calls += 1
        if (calls === 2) throw new Error("offline")
        return { items: [attention()] }
      },
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  await store.refresh()
  assert.equal(store.items().length, 1)
  assert.equal(store.counts().needsYou, 1)
})

test("decision store filters by goal", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({
        items: [
          attention({ goalId: "g1" }),
          attention({ id: "g2:plan_approval:r1", goalId: "g2", coalesceKey: "g2:plan_approval:r1" }),
        ],
      }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.board("g1").counts.needsYou, 1)
  assert.equal(store.board("g2").counts.needsYou, 1)
  assert.equal(store.board(null).counts.needsYou, 2)
})

test("decision store does nothing without a project", async () => {
  let calls = 0
  const store = createDecisionStore({
    api: { attention: async () => { calls += 1; return { items: [] } } },
    projectDir: () => null,
  })
  await store.refresh()
  assert.equal(calls, 0)
  assert.equal(store.items().length, 0)
})

test("decision store fetches attention and records together", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [attention()] }),
      decisions: async () => ({ items: [record({ status: "decided" })] }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.records().length, 1)
  assert.equal(store.board().counts.needsYou, 1)
  assert.equal(store.board().counts.decided, 1)
})

test("confirm refreshes the record list", async () => {
  let status = "draft"
  let updatedAt = "2026-11-12T00:00:00.000Z"
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: async () => ({ items: [record({ status, updatedAt })] }),
      confirm: async () => {
        status = "decided"
        updatedAt = "2026-11-13T00:00:00.000Z"
        return { record: record({ status, updatedAt }) }
      },
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.records()[0]!.status, "draft")
  await store.confirm("dec_1", { rationale: "方案 A 更稳", consequences: "放弃 B" })
  assert.equal(store.records()[0]!.status, "decided")
})

test("reopen moves a decided record back to pending", async () => {
  let status = "decided"
  let updatedAt = "2026-11-12T00:00:00.000Z"
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: async () => ({ items: [record({ status, updatedAt })] }),
      reopen: async () => {
        status = "draft"
        updatedAt = "2026-11-13T00:00:00.000Z"
        return { record: record({ status, updatedAt }) }
      },
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.counts().decided, 1)
  await store.reopen("dec_1")
  assert.equal(store.records()[0]!.status, "draft")
  assert.equal(store.counts().pending, 1)
  assert.equal(store.counts().decided, 0)
})

test("refresh failure keeps previous records", async () => {
  let fail = false
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: async () => {
        if (fail) throw new Error("offline")
        return { items: [record()] }
      },
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  fail = true
  await store.refresh()
  assert.equal(store.records().length, 1)
})

test("refresh preserves record identity when updatedAt is unchanged", async () => {
  let updatedAt = "2026-11-12T00:00:00.000Z"
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: async () => ({ items: [record({ updatedAt })] }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  const first = store.records()[0]!
  await store.refresh()
  assert.equal(store.records()[0], first)

  updatedAt = "2026-11-13T00:00:00.000Z"
  await store.refresh()
  assert.notEqual(store.records()[0], first)
})

test("project switch clears previous decisions even if the new fetch fails", async () => {
  let dir = "C:/a"
  let fail = false
  const store = createDecisionStore({
    api: {
      attention: async () => {
        if (fail) throw new Error("offline")
        return { items: [attention()] }
      },
      decisions: async () => {
        if (fail) throw new Error("offline")
        return { items: [record()] }
      },
    },
    projectDir: () => dir,
  })

  await store.refresh()
  assert.equal(store.items().length, 1)
  assert.equal(store.records().length, 1)

  dir = "C:/b"
  fail = true
  await store.refresh()
  assert.equal(store.items().length, 0)
  assert.equal(store.records().length, 0)
})

// --- E6-3: incremental patch from `decision.updated` -------------------------

function decisionEvent(overrides: Record<string, unknown> = {}, recordOverrides: Record<string, unknown> = {}) {
  return {
    type: "decision.updated",
    properties: {
      action: "confirmed",
      projectDir: "C:/repo",
      goalId: "g1",
      revision: 1,
      recordId: "dec_1",
      record: record(recordOverrides),
      ...overrides,
    },
  }
}

function countingStore(projectDir: () => string | null = () => "C:/repo") {
  const calls = { attention: 0, decisions: 0 }
  const store = createDecisionStore({
    api: {
      attention: async () => { calls.attention += 1; return { items: [] } },
      decisions: async () => { calls.decisions += 1; return { items: [record()] } },
    },
    projectDir,
  })
  return { store, calls }
}

test("ingest inserts the carried record without refetching", () => {
  const { store, calls } = countingStore()
  const handled = store.ingest(decisionEvent({}, { status: "decided", updatedAt: "2026-11-13T00:00:00.000Z" }))

  assert.equal(handled, true)
  assert.equal(store.records().length, 1)
  assert.equal(store.records()[0]!.status, "decided")
  assert.equal(calls.attention, 0)
  assert.equal(calls.decisions, 0)
  assert.ok(store.revision() >= 1)
})

test("ingest patches an existing record in place", async () => {
  const { store, calls } = countingStore()
  await store.refresh()
  assert.equal(store.records()[0]!.status, "draft")
  const before = store.revision()

  const handled = store.ingest(decisionEvent({}, { status: "decided", updatedAt: "2026-11-13T00:00:00.000Z" }))

  assert.equal(handled, true)
  assert.equal(store.records().length, 1)
  assert.equal(store.records()[0]!.status, "decided")
  assert.ok(store.revision() > before)
  assert.equal(calls.attention, 1)
  assert.equal(calls.decisions, 1)
  assert.equal(store.counts().decided, 1)
})

test("ingest keeps record identity when updatedAt is unchanged", async () => {
  const { store } = countingStore()
  await store.refresh()
  const first = store.records()[0]!
  const before = store.revision()

  const handled = store.ingest(decisionEvent())

  assert.equal(handled, true)
  assert.equal(store.records()[0], first)
  assert.equal(store.revision(), before)
})

test("ingest ignores a stale record event", async () => {
  const { store } = countingStore()
  store.ingest(decisionEvent({}, { status: "decided", updatedAt: "2026-11-13T00:00:00.000Z" }))
  const fresh = store.records()[0]!
  const before = store.revision()

  const handled = store.ingest(decisionEvent({}, { status: "draft", updatedAt: "2026-11-11T00:00:00.000Z" }))

  assert.equal(handled, true)
  assert.equal(store.records()[0], fresh)
  assert.equal(store.records()[0]!.status, "decided")
  assert.equal(store.revision(), before)
})

test("ingest patches attention items with the same id", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({
        items: [attention({ id: "dec_1", status: "open", summary: "旧摘要" })],
      } as any),
      decisions: async () => ({ items: [] }),
    },
    projectDir: () => "C:/repo",
  })
  await store.refresh()
  assert.equal((store.items()[0] as any).summary, "旧摘要")

  store.ingest(decisionEvent({}, {
    status: "decided",
    rationale: "方案 A 更稳",
    updatedAt: "2026-11-13T00:00:00.000Z",
  }))

  const seeded = store.items()[0] as any
  assert.equal(seeded.status, "decided")
  assert.equal(seeded.summary, "方案 A 更稳")
  assert.equal(seeded.id, "dec_1")
})

test("ingest does not patch attention from a stale event", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [attention({ id: "dec_1", status: "open", summary: "当前摘要" })] } as any),
      decisions: async () => ({ items: [record({ status: "decided", updatedAt: "2026-11-13T00:00:00.000Z" })] }),
    },
    projectDir: () => "C:/repo",
  })
  await store.refresh()

  const handled = store.ingest(decisionEvent({}, {
    status: "draft",
    rationale: "过期",
    updatedAt: "2026-11-10T00:00:00.000Z",
  }))

  assert.equal(handled, true)
  assert.equal((store.items()[0] as any).status, "open")
  assert.equal((store.items()[0] as any).summary, "当前摘要")
  assert.equal(store.records()[0]!.status, "decided")
})

test("ingest leaves attention alone when no item matches the id", async () => {
  const { store } = countingStore()
  await store.refresh()
  store.ingest(decisionEvent({}, { updatedAt: "2026-11-13T00:00:00.000Z" }))
  assert.equal(store.items().length, 0)
})

test("ingest accepts a bare payload carrying action + record", () => {
  const { store } = countingStore()
  const handled = store.ingest({
    action: "drafted",
    record: record({ status: "decided" }),
  })
  assert.equal(handled, true)
  assert.equal(store.records().length, 1)
})

test("ingest rejects events without a record so the caller refetches", () => {
  const { store, calls } = countingStore()
  const handled = store.ingest({
    type: "decision.updated",
    properties: { action: "drafted", projectDir: "C:/repo", goalId: "g1", revision: 1, recordId: "dec_1" },
  })
  assert.equal(handled, false)
  assert.equal(store.records().length, 0)
  assert.equal(calls.decisions, 0)
})

test("ingest rejects malformed records", () => {
  const { store } = countingStore()
  assert.equal(store.ingest(decisionEvent({}, { id: "" })), false)
  assert.equal(store.ingest(decisionEvent({}, { status: "nope" })), false)
  assert.equal(store.ingest(decisionEvent({}, { updatedAt: "not-a-date" })), false)
  assert.equal(store.ingest({ properties: { action: "bogus", record: record() } }), false)
  assert.equal(store.records().length, 0)
})

test("ingest ignores records from another project", () => {
  const { store } = countingStore(() => "C:/other")
  const handled = store.ingest(decisionEvent())
  assert.equal(handled, true)
  assert.equal(store.records().length, 0)
})

test("ingest tolerates separator/case differences in projectDir", () => {
  const { store } = countingStore(() => "C:\\Repo\\")
  const handled = store.ingest(decisionEvent())
  assert.equal(handled, true)
  assert.equal(store.records().length, 1)
})

// --- E6-3 review: freshness wins over an in-flight refresh -------------------

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

test("a stale in-flight refresh cannot clobber a newer ingested record", async () => {
  const pending = deferred<{ items: any[] }>()
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: () => pending.promise,
    },
    projectDir: () => "C:/repo",
  })

  const inFlight = store.refresh()
  const handled = store.ingest(decisionEvent({}, {
    status: "decided",
    rationale: "新结论",
    updatedAt: "2026-11-13T00:00:00.000Z",
  }))
  assert.equal(handled, true)
  const ingested = store.records()[0]!
  assert.equal(ingested.status, "decided")

  // The refresh started before the event and resolves with the pre-write record.
  pending.resolve({ items: [record({ status: "draft", updatedAt: "2026-11-12T00:00:00.000Z" })] })
  await inFlight

  assert.equal(store.records().length, 1)
  assert.equal(store.records()[0], ingested)
  assert.equal(store.records()[0]!.status, "decided")
})

test("project switch during an in-flight refresh ignores the old response", async () => {
  let dir = "C:/a"
  const pending = deferred<{ items: any[] }>()
  const store = createDecisionStore({
    api: {
      attention: async () => ({ items: [] }),
      decisions: () => pending.promise,
    },
    projectDir: () => dir,
  })

  const inFlight = store.refresh()
  // The user switches projects; the first event for the new project resets the
  // store, which must also invalidate the refresh still in flight for C:/a.
  dir = "C:/b"
  const handled = store.ingest(decisionEvent(
    { projectDir: "C:/b" },
    { id: "dec_b", projectDir: "C:/b", status: "decided", updatedAt: "2026-11-13T00:00:00.000Z" },
  ))
  assert.equal(handled, true)
  assert.equal(store.records().length, 1)
  assert.equal(store.records()[0]!.id, "dec_b")

  pending.resolve({ items: [record({ id: "dec_a", status: "draft", updatedAt: "2026-11-12T00:00:00.000Z" })] })
  await inFlight

  assert.equal(store.records().length, 1)
  assert.equal(store.records()[0]!.id, "dec_b")
  assert.equal(store.records()[0]!.status, "decided")
})

test("ingest without a current project is a no-op", () => {
  const { store, calls } = countingStore(() => null)
  const handled = store.ingest(decisionEvent())
  assert.equal(handled, false)
  assert.equal(store.records().length, 0)
  assert.equal(calls.attention, 0)
  assert.equal(calls.decisions, 0)
})
