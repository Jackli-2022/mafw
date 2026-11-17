// 设计契约：OS 通知只来自事务层（2026-11-17 起连"需要你"也走自绘通知中心 /
// 悬浮窗——main presence + hub）。回合完成 / 子代理完成 / 后台任务完成
// 只在应用内 toast；renderer 不再发任何系统通知。
//
// 源码级断言与其他 design-contract 套件一致（本包没有 jsdom renderer）。
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")
const chatStream = readFileSync(new URL("./sse/handlers/chat-stream.ts", import.meta.url), "utf8")
const subagentNotify = readFileSync(new URL("./subagent-notify.ts", import.meta.url), "utf8")
const backgroundNotify = readFileSync(new URL("./background-notify.ts", import.meta.url), "utf8")
const flowCards = readFileSync(new URL("./sse/handlers/flow-cards.ts", import.meta.url), "utf8")

describe("completion notifications stay in-app", () => {
  test("turn completion no longer wires a notification", () => {
    expect(chatStream).not.toContain("notifyIdle")
    expect(shell).not.toContain("notifyIdle")
    expect(shell).not.toContain("MAFW：回合完成")
  })

  test("subagent / background completion helpers only build toast text", () => {
    expect(subagentNotify).not.toContain("MAFW：子代理完成")
    expect(subagentNotify).not.toContain("os:")
    expect(backgroundNotify).not.toContain("MAFW：后台任务完成")
    expect(backgroundNotify).not.toContain("os:")
  })

  test("renderer needs-you asks publish to the self-drawn hub", () => {
    expect(shell).not.toContain("notifyIfHidden")
    expect(shell).toContain("notifications.publish(input)")
    expect(flowCards).toContain("MAFW：需要权限审批")
    expect(flowCards).toContain("MAFW：Agent 提问")
  })
})
