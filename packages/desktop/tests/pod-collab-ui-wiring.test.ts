// Task 20 接线契约：Plan/Eval 审阅、方向裁定、Spike 报告、Tech Lead 发送通道。
//
// 关键不变量：
//   1. 计划审阅渲染 PlanPackage（Goal Eval / 证据映射 / Probe / hash / revision），
//      不再只是 waves。
//   2. 方向裁定与 Spike 报告在 Goal 详情里可见；attention 文案覆盖 direction_review。
//   3. Tech Lead tab 的发送走 `pod.sendTechLeadMessage`（注入 agent 身份 + 当前 revision
//      ContextManifest），绝不退化成普通 session prompt。
//   4. 活动 Goal 变化时 Goal 详情 keyed 重挂，旧 Goal 的状态不残留。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { techLeadSendTarget } from "../src/renderer/mafw/pod-store"
import { useSendMessage } from "../src/renderer/mafw/chat/use-send-message"
import { createInputHistory } from "../src/renderer/mafw/components/input-history"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const planReview = read("../src/renderer/mafw/components/PlanReviewOverlay.tsx")
const planRender = read("../src/renderer/mafw/components/plan-render.ts")
const goalDetail = read("../src/renderer/mafw/components/GoalDetailOverlay.tsx")
const attention = read("../src/renderer/mafw/components/PodAttentionList.tsx")
const directionPanel = read("../src/renderer/mafw/components/PodDirectionPanel.tsx")
const probePanel = read("../src/renderer/mafw/components/PodProbePanel.tsx")
const podModel = read("../src/renderer/mafw/pod-model.ts")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")
const sendHook = read("../src/renderer/mafw/chat/use-send-message.ts")
const sdkTypes = read("../../gateway-sdk/src/types.ts")

test("计划审阅使用 PlanPackage 渲染（Goal Eval / Probe / hash）", () => {
  assert.match(planRender, /export function renderPlanPackage/)
  assert.match(planReview, /renderPlanPackage/)
  assert.match(planReview, /podStore\.detail/)
  assert.match(planReview, /probes\(/)
  assert.match(planReview, /planHash|evalHash/)
})

test("方向裁定面板：pending 可记录、decided 只读", () => {
  assert.match(directionPanel, /export function directionAction/)
  assert.match(directionPanel, /记录方向决定/)
  assert.match(directionPanel, /onDecide/)
})

test("Spike 报告卡：结论徽标 + 证据/复现/剩余假设/影响", () => {
  assert.match(probePanel, /export function probeBadge/)
  assert.match(probePanel, /否定假设/)
  assert.match(probePanel, /剩余假设/)
  assert.match(probePanel, /影响/)
  assert.match(probePanel, /repro/)
})

test("Goal 详情挂载方向/探针/阶段，并在 stage 变化时刷新", () => {
  assert.match(goalDetail, /import \{ PodDirectionPanel \}/)
  assert.match(goalDetail, /import \{ PodProbePanel \}/)
  assert.match(goalDetail, /<PodDirectionPanel/)
  assert.match(goalDetail, /<PodProbePanel/)
  assert.match(goalDetail, /podStageLabel/)
  assert.match(goalDetail, /directionDecision\(/)
})

test("方向 attention 使用现有 PodAttentionList 并有人类可读标签", () => {
  assert.match(attention, /direction_review/)
  assert.match(attention, /方向/)
  assert.match(attention, /open_direction_review|onOpenGoal/)
})

test("阶段文案覆盖 discussing / direction_review / planning / probing / implementing / reviewing / result_notified", () => {
  for (const kind of ["discussing", "direction_review", "planning", "probing", "implementing", "reviewing", "result_notified"]) {
    assert.match(podModel, new RegExp(kind), `pod-model.ts 缺阶段文案: ${kind}`)
  }
})

test("SDK stage 类型包含新 kind / role / action（Task 19 前置项）", () => {
  assert.match(sdkTypes, /PodGoalStageKind/)
  for (const kind of ["discussing", "direction_review", "planning", "probing", "implementing", "reviewing", "result_notified"]) {
    assert.ok(sdkTypes.includes(`'${kind}'`), `SDK PodGoalStageKind 缺 ${kind}`)
  }
  assert.match(sdkTypes, /open_direction_review/)
  assert.match(sdkTypes, /open_discussion/)
  assert.match(sdkTypes, /role\?: PodMemberRole/)
  assert.match(sdkTypes, /'direction_review'/)
})

test("活动 Goal 变化时 keyed 重挂（不残留旧状态）", () => {
  assert.match(shell, /<Show when=\{podGoalId\(\)\} keyed>/)
})

test("Tech Lead tab 发送走 pod.sendTechLeadMessage（保留身份/ContextManifest）", () => {
  assert.match(sendHook, /techLeadTarget/)
  assert.match(sendHook, /pod\.sendTechLeadMessage\(/)
  assert.match(chatPane, /techLeadTarget/)
  assert.match(shell, /techLeadTarget=\{/)
  assert.match(shell, /techLeadSendTarget\(/)
  // 必须真的调用发送通道，而不是继续走普通会话 prompt
  const it = sendHook.indexOf("sendTechLeadMessage")
  const enriched = sendHook.indexOf("chat.sendEnriched")
  assert.ok(it > 0, "use-send-message 必须调用 sendTechLeadMessage")
  assert.ok(enriched > 0, "普通路径仍需保留")
})

test("techLeadSendTarget：只有 goal+pod 都已知才路由", () => {
  assert.deepEqual(techLeadSendTarget("g1", "pod_1"), { podId: "pod_1", goalId: "g1" })
  assert.equal(techLeadSendTarget("", "pod_1"), null)
  assert.equal(techLeadSendTarget("g1", ""), null)
  assert.equal(techLeadSendTarget(undefined, undefined), null)
})

test("Tech Lead 会话实际发送走 sendTechLeadMessage，不走普通 sendEnriched", async () => {
  const leadCalls: any[][] = []
  const enrichedCalls: any[] = []
  ;(globalThis as any).window = {
    api: {
      mafw: {
        chat: { sendEnriched: async (req: any) => { enrichedCalls.push(req); return { sessionID: "s1" } } },
        pod: {
          sendTechLeadMessage: async (...args: any[]) => {
            leadCalls.push(args)
            return { goalId: "g1", revision: 1, sessionID: "s1", text: args[2] }
          },
        },
      },
    },
  }
  try {
    let input = "我们做 A 还是 B"
    const history = createInputHistory()
    const { sendMessage } = useSendMessage({
      sid: () => "s1",
      onCreateSession: async () => null,
      onSetUserMsgId: () => {},
      input: () => input,
      setInput: (v: string) => { input = v },
      sending: () => false,
      setSending: () => {},
      setPhase: () => {},
      attachments: () => [],
      setAttachments: () => {},
      mentionedAgents: () => [],
      setMentionedAgents: () => {},
      mentionedFiles: () => [],
      setMentionedFiles: () => {},
      queuedItems: () => [],
      setQueuedItems: () => {},
      textareaEl: () => null,
      history,
      clearDraft: () => {},
      matchSlash: () => null,
      agentSel: () => null,
      model: () => null,
      setStore: () => {},
      forceAnchor: () => {},
      imageToDataUrl: async () => undefined,
      uploadMediaBinary: async () => "",
      encodeFilePath: (p: string) => p,
      techLeadTarget: () => ({ podId: "pod_1", goalId: "g1" }),
    } as any)
    await sendMessage()
    assert.equal(enrichedCalls.length, 0, "不得回落到普通会话 prompt")
    assert.equal(leadCalls.length, 1)
    assert.equal(leadCalls[0][0], "pod_1")
    assert.equal(leadCalls[0][1], "g1")
    assert.match(leadCalls[0][2], /A 还是 B/)
  } finally {
    delete (globalThis as any).window
  }
})

test("Tech Lead 会话忙时也只本地排队（不在 steer 通道丢身份）", async () => {
  const promptCalls: any[] = []
  const leadCalls: any[] = []
  ;(globalThis as any).window = {
    api: {
      mafw: {
        sessions: { promptAsync: async (req: any) => { promptCalls.push(req) } },
        pod: { sendTechLeadMessage: async (...args: any[]) => { leadCalls.push(args); return { sessionID: "s1" } } },
      },
    },
  }
  try {
    let queued: any[] = []
    const history = createInputHistory()
    const { sendMessage } = useSendMessage({
      sid: () => "s1",
      onCreateSession: async () => null,
      onSetUserMsgId: () => {},
      input: () => "继续讨论",
      setInput: () => {},
      sending: () => true,
      setSending: () => {},
      setPhase: () => {},
      attachments: () => [],
      setAttachments: () => {},
      mentionedAgents: () => [],
      setMentionedAgents: () => {},
      mentionedFiles: () => [],
      setMentionedFiles: () => {},
      queuedItems: () => queued,
      setQueuedItems: (fn: (prev: any[]) => any[]) => { queued = fn(queued) },
      textareaEl: () => null,
      history,
      clearDraft: () => {},
      matchSlash: () => null,
      agentSel: () => null,
      model: () => null,
      setStore: () => {},
      forceAnchor: () => {},
      imageToDataUrl: async () => undefined,
      uploadMediaBinary: async () => "",
      encodeFilePath: (p: string) => p,
      steerSupported: () => true,
      techLeadTarget: () => ({ podId: "pod_1", goalId: "g1" }),
    } as any)
    await sendMessage()
    assert.equal(promptCalls.length, 0, "忙时也不得走普通 promptAsync")
    assert.equal(leadCalls.length, 0)
    assert.equal(queued.length, 1)
  } finally {
    delete (globalThis as any).window
  }
})

test("新面板符合设计契约（无裸 button/input/title）", () => {
  for (const [name, src] of [["PodDirectionPanel", directionPanel], ["PodProbePanel", probePanel]] as const) {
    assert.match(src, /ButtonV2/, `${name} 必须用 ButtonV2`)
    assert.doesNotMatch(src, /<button/, `${name} 不得用裸 button`)
    assert.doesNotMatch(src, /<input/, `${name} 不得用裸 input`)
    assert.doesNotMatch(src, /\stitle=/, `${name} 不得用裸 title`)
  }
  assert.match(directionPanel, /TextInputV2|TextareaV2/)
})
