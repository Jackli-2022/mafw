// Source contract：自绘通知的 renderer 来源接线。
// permission/question/user_question → notifications.publish；
// replied/rejected/结果已查看 → 自动已读；p3 完成不进 hub。
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const flowCards = readFileSync(new URL("./sse/handlers/flow-cards.ts", import.meta.url), "utf8")
const dispatcher = readFileSync(new URL("./sse/dispatcher.ts", import.meta.url), "utf8")
const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")
const resultStore = readFileSync(new URL("./pod-result-store.ts", import.meta.url), "utf8")
const shellNotify = readFileSync(new URL("./components/NotificationCenter.tsx", import.meta.url), "utf8")

describe("notification source wiring", () => {
  test("flow-cards publishes permission/question with dedupe keys", () => {
    expect(flowCards).toContain('`permission:${card.id}`')
    expect(flowCards).toContain('`question:${id}`')
    expect(flowCards).toContain('type: "approval"')
    expect(flowCards).toContain('type: "question"')
  })

  test("answered asks mark their notifications read", () => {
    expect(flowCards).toContain("markNotificationRead")
    expect(flowCards).toContain("question.replied")
    expect(flowCards).toContain("permission.replied")
  })

  test("goal-level questions route to the goal question panel", () => {
    expect(dispatcher).toContain('`user-question:')
    expect(dispatcher).toContain('focus: "question"')
  })

  test("viewing a result marks the p1 notification read", () => {
    expect(resultStore).toContain("markNotificationsReadByDedupe")
    expect(resultStore).toContain("`${goalId}:r${revision}`")
  })

  test("the shell provides publish/markRead/projectOf deps", () => {
    expect(shell).toContain("markNotificationRead: (keys)")
    expect(shell).toContain("projectOf: (sid)")
    expect(shell).toContain("publish: (input)")
  })

  test("p3 completion toasts never touch the hub", () => {
    expect(shellNotify).not.toContain("publish")
  })
})
