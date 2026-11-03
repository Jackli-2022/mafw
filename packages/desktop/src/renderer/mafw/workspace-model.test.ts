import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodGoal, PodWorkBucket, PodWorkOverview } from "@mafw/sdk"
import { workspaceSections } from "./workspace-model"

function goal(index: number, bucket: PodWorkBucket): PodGoal {
  return {
    id: `pg-${index}`,
    podId: "pod_1",
    goalId: `g-${index}`,
    status: bucket === "queued" ? "queued" : bucket === "ended" ? "done" : "active",
    title: `Goal ${index}`,
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "working" },
    bucket,
    resultReady: bucket === "result_ready",
    enqueuedAt: "2026-11-03T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
  }
}

function overview(groups: Partial<Record<PodWorkBucket, PodGoal[]>>): PodWorkOverview {
  const fill = (bucket: PodWorkBucket) => groups[bucket] ?? []
  return {
    projectDir: "/project",
    podId: "pod_1",
    groups: {
      needs_you: fill("needs_you"),
      queued: fill("queued"),
      in_progress: fill("in_progress"),
      result_ready: fill("result_ready"),
      ended: fill("ended"),
    },
    counts: {
      needs_you: fill("needs_you").length,
      queued: fill("queued").length,
      in_progress: fill("in_progress").length,
      result_ready: fill("result_ready").length,
      ended: fill("ended").length,
    },
    total: Object.values(groups).reduce((sum, list) => sum + (list?.length ?? 0), 0),
  }
}

test("workspaceSections derives every count from the same list", () => {
  const sections = workspaceSections(overview({
    needs_you: [goal(1, "needs_you")],
    in_progress: [goal(2, "in_progress"), goal(3, "in_progress")],
    ended: [goal(4, "ended")],
  }))
  for (const section of sections) {
    assert.equal(section.count, section.goals.length)
  }
  assert.deepEqual(sections.map((section) => section.bucket), [
    "needs_you", "queued", "in_progress", "result_ready", "ended",
  ])
  assert.equal(sections[0].count, 1)
  assert.equal(sections[2].count, 2)
})

test("workspaceSections never truncates a 200-goal history", () => {
  const ended = Array.from({ length: 200 }, (_, index) => goal(index, "ended"))
  const sections = workspaceSections(overview({ ended }))
  const section = sections.find((item) => item.bucket === "ended")!
  assert.equal(section.goals.length, 200)
  assert.equal(section.count, 200)
})

test("workspaceSections tolerates an old gateway with missing groups", () => {
  const old = { projectDir: "/p", podId: "pod_1", groups: {}, counts: {}, total: 0 } as unknown as PodWorkOverview
  const sections = workspaceSections(old)
  assert.equal(sections.length, 5)
  assert.ok(sections.every((section) => section.count === 0 && section.goals.length === 0))
})
