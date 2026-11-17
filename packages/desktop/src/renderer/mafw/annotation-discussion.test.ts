import { describe, expect, test } from "bun:test"
import { chatAcceptsAnnotation, deliverAnnotationDiscussion } from "./annotation-discussion"
import type { Annotation } from "../../shared/annotation-types"

const annotation = (id: string, over: Partial<Annotation> = {}): Annotation => ({
  id,
  sessionID: "s1",
  rel: `src/${id}.ts`,
  startLine: 1,
  endLine: 1,
  code: "x",
  comment: `意见 ${id}`,
  createdAt: 1,
  source: { kind: "project", projectDir: "C:/repo" },
  ...over,
})

function fakeDeps() {
  const calls = {
    sendChat: [] as any[],
    sendTechLead: [] as any[],
    markDiscussed: [] as any[],
    ensureLead: [] as string[],
    ensureTechLead: [] as string[],
  }
  return {
    calls,
    ensureLead: async (podId: string) => { calls.ensureLead.push(podId); return { sessionId: "lead_s1" } },
    ensureTechLead: async (goalId: string) => { calls.ensureTechLead.push(goalId); return { sessionID: "tl_s1", revision: 2 } },
    sendChat: async (input: any) => { calls.sendChat.push(input) },
    sendTechLead: async (input: any) => { calls.sendTechLead.push(input) },
    markDiscussed: (ids: readonly string[], at: number) => { calls.markDiscussed.push({ ids, at }) },
  }
}

describe("annotation discussion", () => {
  test("Lead delivery sends one message and marks only after success", async () => {
    const deps = fakeDeps()
    const result = await deliverAnnotationDiscussion({
      annotations: [annotation("a1"), annotation("b1", { source: { kind: "goal", projectDir: "C:/repo", goalId: "g2", revision: 1 } })],
      target: { kind: "lead", podId: "pod_1" },
    }, deps)
    expect(result.sessionID).toBe("lead_s1")
    expect(deps.calls.ensureLead).toEqual(["pod_1"])
    expect(deps.calls.sendChat).toHaveLength(1)
    expect(deps.calls.sendChat[0].message).toContain("src/a1.ts")
    expect(deps.calls.sendChat[0].message).toContain("src/b1.ts")
    expect(deps.calls.sendTechLead).toHaveLength(0)
    expect(deps.calls.markDiscussed[0].ids).toEqual(["a1", "b1"])
  })

  test("failed Lead delivery does not mark drafts", async () => {
    const deps = fakeDeps()
    deps.sendChat = async () => { throw new Error("offline") }
    await expect(deliverAnnotationDiscussion({
      annotations: [annotation("a1")],
      target: { kind: "lead", podId: "pod_1" },
    }, deps)).rejects.toThrow("offline")
    expect(deps.calls.markDiscussed).toHaveLength(0)
  })

  test("Tech Lead delivery uses the Tech Lead transport, not promptAsync", async () => {
    const deps = fakeDeps()
    const result = await deliverAnnotationDiscussion({
      annotations: [annotation("a1", { source: { kind: "goal", projectDir: "C:/repo", goalId: "g2", revision: 2 } })],
      target: { kind: "techlead", podId: "pod_1", goalId: "g2" },
    }, deps)
    expect(result.sessionID).toBe("tl_s1")
    expect(deps.calls.ensureTechLead).toEqual(["g2"])
    expect(deps.calls.sendTechLead[0]).toMatchObject({ podId: "pod_1", goalId: "g2" })
    expect(deps.calls.sendChat).toHaveLength(0)
    expect(deps.calls.markDiscussed[0].ids).toEqual(["a1"])
  })

  test("Goal B annotation is not accepted by Goal A Tech Lead composer", () => {
    const goalB = annotation("b1", {
      source: { kind: "goal", projectDir: "C:/repo", goalId: "g2", revision: 1 },
    })
    expect(chatAcceptsAnnotation(goalB, { kind: "techlead", goalId: "g1" })).toBe(false)
    expect(chatAcceptsAnnotation(goalB, { kind: "techlead", goalId: "g2" })).toBe(true)
    expect(chatAcceptsAnnotation(goalB, { kind: "free" })).toBe(true)
  })
})
