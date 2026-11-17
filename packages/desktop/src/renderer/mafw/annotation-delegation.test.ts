import { describe, expect, test } from "bun:test"
import {
  buildNewGoalDraft,
  delegateAnnotationBatch,
  delegationFollowUp,
  eligibleDelegationGoals,
  reviewInputsForDelegation,
  targetVersionProblem,
  validateDelegationTarget,
} from "./annotation-delegation"
import type { Annotation } from "../../shared/annotation-types"
import type { PodGoal } from "@mafw/sdk"

const projectSource = { kind: "project" as const, projectDir: "C:/repo" }
const goalSource = (goalId = "g2", revision = 1) => ({
  kind: "goal" as const, projectDir: "C:/repo", goalId, revision,
})

const annotation = (id: string, over: Partial<Annotation> = {}): Annotation => ({
  id,
  sessionID: "s1",
  rel: `src/${id}.ts`,
  startLine: 2,
  endLine: 2,
  code: "x",
  comment: `意见 ${id}`,
  createdAt: 1,
  scopeKey: "project:C:/repo",
  root: "C:/repo",
  source: projectSource,
  contentVersion: "hash",
  ...over,
})

function goal(over: Partial<PodGoal> = {}): PodGoal {
  return {
    podId: "pod_1",
    goalId: "g1",
    status: "active",
    title: "Goal",
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "discussing" },
    resultReady: false,
    enqueuedAt: "2026-11-17T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    activeRevision: 1,
    accepted: false,
    ...over,
  } as PodGoal
}

function fakeDeps() {
  const log: string[] = []
  let createdGoals = 0
  return {
    log,
    get createdGoals() { return createdGoals },
    createGoal: async (input: any) => {
      log.push("createGoal")
      createdGoals++
      return { goalId: "g_new", revision: 1, input }
    },
    createReviewItems: async (target: any, body: any) => {
      log.push(`createReviewItems:${target.goalId}:${body.revision}`)
      return { items: body.items.map((item: any, index: number) => ({
        id: `review_${index + 1}`,
        podId: target.podId,
        goalId: target.goalId,
        revision: target.revision,
        status: "pending",
        rel: item.rel,
        startLine: item.startLine ?? null,
        endLine: item.endLine ?? null,
        code: item.code ?? "",
        comment: item.comment,
        anchor: item.anchor ?? null,
        source: item.source ?? null,
        clientRef: item.clientRef ?? null,
        response: null,
        originItemId: null,
        originRevision: null,
        createdAt: "2026-11-17T00:00:00.000Z",
        updatedAt: "2026-11-17T00:00:00.000Z",
        respondedAt: null,
        resolvedAt: null,
      })) }
    },
    getPlan: async (goalId: string) => {
      log.push(`getPlan:${goalId}`)
      return { planApproval: { id: "approval_1" } }
    },
    rejectPlan: async (goalId: string, approvalId: string | undefined) => {
      log.push(`rejectPlan:${goalId}:${approvalId}`)
    },
    sendTechLead: async (input: any) => {
      log.push(`sendTechLead:${input.goalId}`)
    },
    rejectResult: async (podId: string, goalId: string) => {
      log.push(`rejectResult:${podId}:${goalId}`)
      return { revision: 2 }
    },
    markDelegated: (ids: readonly string[], reviewItemIDs: readonly string[]) => {
      log.push(`markDelegated:${ids.join(",")}:${reviewItemIDs.join(",")}`)
    },
  }
}

describe("annotation delegation", () => {
  test("follow-up mapping is stable by stage", () => {
    expect(delegationFollowUp(goal())).toEqual({ kind: "notify" })
    expect(delegationFollowUp(goal({ stage: { owner: "person", kind: "plan_approval" } })))
      .toEqual({ kind: "replan", goalId: "g1" })
    expect(delegationFollowUp(goal({ stage: { owner: "team", kind: "implementing" } })))
      .toEqual({ kind: "record-only" })
    expect(delegationFollowUp(goal({ stage: { owner: "team", kind: "result_notified" }, resultReady: true })))
      .toEqual({ kind: "rework", goalId: "g1" })
    expect(delegationFollowUp(goal({ stage: { owner: "person", kind: "ended" } })).kind).toBe("blocked")
  })

  test("one batch creates clientRef/source inputs once and marks delegated", async () => {
    const deps = fakeDeps()
    const out = await delegateAnnotationBatch({
      annotations: [annotation("a1"), annotation("a2")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", goalId: "g1", revision: 1 },
      goal: goal(),
    }, deps)
    expect(out.goalId).toBe("g1")
    expect(out.error).toBeNull()
    expect(deps.log.filter((line) => line.startsWith("createReviewItems"))).toHaveLength(1)
    expect(deps.log).toContain("markDelegated:a1,a2:review_1,review_2")
    const inputs = reviewInputsForDelegation([annotation("a1"), annotation("a2")])
    expect(inputs.map((input) => input.clientRef)).toEqual(["a1", "a2"])
    expect(inputs[0].source).toEqual({
      kind: "project", projectDir: "C:/repo", root: "C:/repo", contentVersion: "hash",
    })
  })

  test("goal-source batch cannot target another or terminal goal", () => {
    const goalB = annotation("b1", { source: goalSource("g2", 2), scopeKey: "goal:C:/repo:g2:r2" })
    expect(validateDelegationTarget({
      annotations: [goalB], projectDir: "C:/repo", target: { goalId: "g1", revision: 1 },
    })).toMatch(/Goal/)
    expect(validateDelegationTarget({
      annotations: [annotation("a1")], projectDir: "C:/repo", target: { goalId: "g1", accepted: true },
    })).toMatch(/验收/)
    expect(validateDelegationTarget({
      annotations: [goalB], projectDir: "C:/repo", target: { goalId: "g2", revision: 3 },
    })).toMatch(/revision/)
  })

  test("dirty source and mismatched binary target are blocked", () => {
    expect(validateDelegationTarget({
      annotations: [annotation("a1", { capturedDirty: true })],
      projectDir: "C:/repo",
      target: { goalId: "g1", revision: 1 },
    })).toMatch(/保存/)
    expect(targetVersionProblem({ sourceHash: "a", targetHash: "b", textAnchorAvailable: false }))
      .toMatch(/版本/)
    expect(targetVersionProblem({ sourceHash: "a", targetHash: "a", textAnchorAvailable: false })).toBeNull()
  })

  test("result-ready delegation rejects once after writing items", async () => {
    const deps = fakeDeps()
    const out = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", goalId: "g1", revision: 1 },
      goal: goal({ stage: { owner: "person", kind: "result_notified" }, resultReady: true }),
    }, deps)
    expect(out.followUp).toEqual({ kind: "rework", goalId: "g1" })
    expect(deps.log.indexOf("createReviewItems:g1:1")).toBeLessThan(deps.log.indexOf("rejectResult:pod_1:g1"))
    expect(deps.log.filter((line) => line.startsWith("rejectResult"))).toHaveLength(1)
  })

  test("plan approval writes items before replan", async () => {
    const deps = fakeDeps()
    await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", goalId: "g1", revision: 1 },
      goal: goal({ stage: { owner: "person", kind: "plan_approval" } }),
    }, deps)
    expect(deps.log.indexOf("createReviewItems:g1:1")).toBeLessThan(deps.log.indexOf("getPlan:g1"))
    expect(deps.log).toContain("rejectPlan:g1:approval_1")
  })

  test("late tab changes cannot retarget an in-flight batch", async () => {
    const deps = fakeDeps()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const originalCreate = deps.createReviewItems
    deps.createReviewItems = async (target: any, body: any) => {
      await gate
      return originalCreate(target, body)
    }
    const target = { podId: "pod_1", goalId: "g1", revision: 1 }
    const pending = delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target,
      goal: goal(),
    }, deps)
    target.goalId = "g_other"
    target.revision = 9
    release()
    const out = await pending
    expect(out.goalId).toBe("g1")
    expect(out.revision).toBe(1)
    expect(deps.log).toContain("createReviewItems:g1:1")
  })

  test("new Goal follow-up failure returns its id; retry never creates a second Goal", async () => {
    const deps = fakeDeps()
    let failNotify = true
    deps.sendTechLead = async (input: any) => {
      deps.log.push(`sendTechLead:${input.goalId}`)
      if (failNotify) throw new Error("notify failed")
    }
    const first = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", newGoal: true },
    }, deps)
    expect(first.goalId).toBe("g_new")
    expect(first.error).toMatch(/notify failed/)
    expect(deps.createdGoals).toBe(1)
    expect(deps.log).not.toContain("markDelegated:a1:review_1")

    failNotify = false
    const retry = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", goalId: "g_new", revision: 1 },
      goal: goal({ goalId: "g_new" }),
    }, deps)
    expect(retry.goalId).toBe("g_new")
    expect(retry.error).toBeNull()
    expect(deps.createdGoals).toBe(1)
    expect(deps.log.filter((line) => line === "markDelegated:a1:review_1")).toHaveLength(1)
  })

  test("retry can reuse an existing target with the original follow-up", async () => {
    const deps = fakeDeps()
    const out = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", goalId: "g1", revision: 1 },
      followUpOverride: { kind: "rework", goalId: "g1" },
    }, deps)
    expect(out.error).toBeNull()
    expect(deps.log).toContain("rejectResult:pod_1:g1")
    expect(deps.log).toContain("markDelegated:a1:review_1")
  })

  test("new Goal item failure still returns the created goal id", async () => {
    const deps = fakeDeps()
    deps.createReviewItems = async () => { throw new Error("db down") }
    const out = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", newGoal: true },
    }, deps)
    expect(out.goalId).toBe("g_new")
    expect(out.error).toMatch(/db down/)
  })

  test("new Goal path still rejects dirty, source-less, cross-goal, and cross-project drafts", async () => {
    const cases = [
      annotation("dirty", { capturedDirty: true }),
      annotation("legacy", { source: undefined }),
      annotation("goal", { source: goalSource("g2", 1), scopeKey: "goal:C:/repo:g2:r1" }),
      annotation("other-project", { source: { kind: "project", projectDir: "C:/other" } }),
    ]
    for (const item of cases) {
      const deps = fakeDeps()
      const out = await delegateAnnotationBatch({
        annotations: [item],
        projectDir: "C:/repo",
        target: { podId: "pod_1", newGoal: true },
      }, deps)
      expect(out.error).toBeTruthy()
      expect(deps.createdGoals).toBe(0)
      expect(deps.log).not.toContain("createGoal")
    }
  })

  test("new Goal keeps composer draft and blocks before items when target verification fails", async () => {
    const deps = fakeDeps()
    ;(deps as any).verifyTarget = async () => "目标 revision 的文件版本已变化"
    const out = await delegateAnnotationBatch({
      annotations: [annotation("a1")],
      projectDir: "C:/repo",
      target: { podId: "pod_1", newGoal: true },
      newGoalDraft: {
        title: "自定义标题",
        objective: "自定义目标",
        acceptance: ["自定义验收"],
        boundaries: ["不改架构"],
        planReview: "manual",
      },
    }, deps)
    expect(deps.log).toContain("createGoal")
    expect(deps.log.some((line) => line.startsWith("createReviewItems"))).toBe(false)
    expect(out.error).toMatch(/版本/)
  })

  test("new Goal draft is prefilled from the batch", () => {
    const draft = buildNewGoalDraft([annotation("a1"), annotation("a2")])
    expect(draft.title).toContain("2")
    expect(draft.objective).toContain("src/a1.ts")
    expect(draft.acceptance.length).toBeGreaterThan(0)
    expect(eligibleDelegationGoals([goal(), goal({ goalId: "g2", status: "done" })], [annotation("a1")]))
      .toHaveLength(1)
  })
})
