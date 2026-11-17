import { describe, expect, test } from "bun:test"
import { navigateNotificationTarget, type NotificationNavigationDeps } from "./target-router"
import type { NotificationTarget } from "../../../shared/notifications"

function deps(current = "C:/project-a") {
  const calls: Array<[string, ...unknown[]]> = []
  const api: NotificationNavigationDeps = {
    currentProject: () => current,
    selectProject: async (project) => {
      calls.push(["selectProject", project])
    },
    openSession: (id) => {
      calls.push(["openSession", id])
    },
    openGoal: (id, focus) => {
      calls.push(["openGoal", id, focus])
    },
    openWork: () => {
      calls.push(["openWork"])
    },
    openConfig: () => {
      calls.push(["openConfig"])
    },
  }
  return { api, calls }
}

describe("navigateNotificationTarget", () => {
  test("session opens the tab without switching projects when already current", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget({ type: "session", sessionID: "s1", projectId: "C:/project-a" }, api)
    expect(calls).toEqual([["openSession", "s1"]])
  })

  test("switches project before opening a cross-project target", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget({ type: "session", sessionID: "s1", projectId: "C:/project-b" }, api)
    expect(calls).toEqual([["selectProject", "C:/project-b"], ["openSession", "s1"]])
  })

  test("goal keeps the focus and defaults to timeline", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget({ type: "goal", goalId: "g1" }, api)
    await navigateNotificationTarget({ type: "goal", goalId: "g2", focus: "question" }, api)
    expect(calls).toEqual([
      ["openGoal", "g1", "timeline"],
      ["openGoal", "g2", "question"],
    ])
  })

  test("approval and question open their session", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget({ type: "approval", sessionID: "s1", requestId: "r1" }, api)
    await navigateNotificationTarget({ type: "question", sessionID: "s2", requestId: "q1" }, api)
    expect(calls).toEqual([["openSession", "s1"], ["openSession", "s2"]])
  })

  test("work and config are direct", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget({ type: "work" }, api)
    await navigateNotificationTarget({ type: "config", section: "desktop" }, api)
    expect(calls).toEqual([["openWork"], ["openConfig"]])
  })

  test("missing target is a no-op", async () => {
    const { api, calls } = deps()
    await navigateNotificationTarget(undefined, api)
    expect(calls).toEqual([])
  })
})
