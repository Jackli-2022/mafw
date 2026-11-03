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
import {
  createPodIdResolver,
  podResolveKey,
  resetPodDetailCache,
  resolvePodDetail,
  resolvePodDetailCached,
  resolvePodId,
  techLeadSendTarget,
} from "../src/renderer/mafw/pod-store"
import { podSessionRoute, techLeadRouteForSession, techLeadSendBlockedReason, techLeadSendGate, TECH_LEAD_UNRESOLVED_GUIDANCE } from "../src/renderer/mafw/pod-model"
import { useSendMessage } from "../src/renderer/mafw/chat/use-send-message"
import { createInputHistory } from "../src/renderer/mafw/components/input-history"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const css = read("../src/renderer/mafw/mafw.css")

/** 取选择器（首次出现）的规则体；找不到返回空串。 */
function cssBlock(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) return ""
  const open = css.indexOf("{", start)
  let depth = 1
  let i = open + 1
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++
    if (css[i] === "}") depth--
    i++
  }
  return css.slice(open + 1, i - 1)
}

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
  assert.match(shell, /techLeadSendGate\(/)
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

// ── Review fixes (2026-11-03) ─────────────────────────────────────────────

const POD_DETAIL = {
  pod: { id: "pod_1" },
  members: [
    { id: "m_lead", role: "lead" },
    { id: "m_t", role: "tech_lead" },
    { id: "m_b", role: "builder" },
  ],
  sessions: [
    { sessionId: "ses_disc", memberId: "m_t", goalId: "g1", node: null, scopeKind: "discussion" },
    { sessionId: "ses_plan", memberId: "m_t", goalId: "g1", node: "plan", scopeKind: null },
    { sessionId: "ses_build", memberId: "m_b", goalId: "g1", node: "execute", scopeKind: "implementation" },
  ],
  goals: [{ goalId: "g1", title: "Pod loop" }],
} as any

test("所有 Pod 会话入口都经 openPodSession（Tech Lead 讨论可推断）", () => {
  assert.match(shell, /const openPodSession = async \(sid: string, title\?: string\)/)
  assert.match(shell, /onPodOpenSession=\{\(sid\) => \{ void openPodSession\(sid\) \}\}/)
  assert.match(shell, /onOpenPodSession=\{\(sid, title\) => \{ void openPodSession\(sid, title\) \}\}/)
  assert.match(shell, /<DashboardPage onOpenSession=\{\(sid\) => \{ void openPodSession\(sid\) \}\}/)
  assert.match(shell, /onOpenSession=\{\(sid\) => \{ void openPodSession\(sid\) \}\}/)
  assert.match(shell, /activeTechLeadBlocked/)
  assert.match(shell, /sendBlocked=\{activeTechLeadBlocked\}/)
  assert.match(chatPane, /sendBlocked/)
})

test("Lead 从 Pod 打开前显式 ensure，并升级已有 tab 的 Lead 身份", () => {
  assert.match(shell, /await podStore\.ensureLead\(\)/)
  assert.match(shell, /resolveLeadSession\(\{ leadSessionId: ensured\.sessionId \}\)/)
  assert.match(shell, /leadTabMetadata\(\)/)
  const openTab = shell.slice(shell.indexOf("const openSessionTab"), shell.indexOf("// Single resolution path"))
  assert.match(openTab, /else if \(lead !== undefined \|\| metadata !== undefined\)/)
  assert.match(openTab, /\{\s*\.\.\.s,.*lead.*metadata/s)
})

test("layout restore waits for Pod resolution and has no manager-session fallback", () => {
  assert.match(shell, /podStore\.resolvedFor\(/)
  assert.match(shell, /leadSessionIdFromPod\(/)
  assert.doesNotMatch(shell, /fetchManagerSession/)
  assert.doesNotMatch(shell, /leadIdFor/)
  assert.doesNotMatch(shell, /window\.api\.mafw\.manager\.session/)
})

test("techLeadRouteForSession：讨论会话可路由，plan 节点会话被拦", () => {
  assert.deepEqual(techLeadRouteForSession(POD_DETAIL, "ses_disc"), { podId: "pod_1", goalId: "g1" })
  assert.equal(techLeadRouteForSession(POD_DETAIL, "ses_plan"), null)
  assert.equal(techLeadRouteForSession(POD_DETAIL, "ses_build"), null)
  assert.equal(techLeadRouteForSession(POD_DETAIL, "ses_unknown"), null)
  assert.match(techLeadSendBlockedReason(POD_DETAIL, "ses_plan") ?? "", /Tech Lead 讨论/)
  assert.equal(techLeadSendBlockedReason(POD_DETAIL, "ses_disc"), null)
  assert.equal(techLeadSendBlockedReason(POD_DETAIL, "ses_build"), null)
})

test("podSessionRoute 容忍旧 gateway（无 sessions/scopeKind）", () => {
  assert.equal(podSessionRoute(null, "ses_disc"), null)
  assert.equal(podSessionRoute({ ...POD_DETAIL, sessions: undefined } as any, "ses_disc"), null)
  const legacy = { pod: { id: "pod_1" }, members: [{ id: "m_t", role: "tech_lead" }], sessions: [{ sessionId: "s", memberId: "m_t", goalId: "g1", node: "discussion" }] } as any
  assert.equal(podSessionRoute(legacy, "s")?.isDiscussion, true)
})

test("sendBlocked：Tech Lead 节点会话保留草稿且不发任何请求", async () => {
  const calls: any[] = []
  ;(globalThis as any).window = {
    api: {
      mafw: {
        chat: { sendEnriched: async (req: any) => { calls.push(["chat", req]); return { sessionID: "s1" } } },
        pod: { sendTechLeadMessage: async (...args: any[]) => { calls.push(["pod", ...args]); return { sessionID: "s1" } } },
      },
    },
  }
  try {
    let input = "这条消息不该发出去"
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
      sendBlocked: () => "这是 Tech Lead 的节点会话；请打开该 Goal 的「Tech Lead 讨论」后再发送。",
    } as any)
    await sendMessage()
    assert.equal(calls.length, 0)
    assert.equal(input, "这条消息不该发出去")
    assert.equal(history.up(""), null)
  } finally {
    delete (globalThis as any).window
  }
})

test("resolvePodId：显式 → 已加载 → 按目录 lookup；失败 fail-open", async () => {
  const lookups: string[] = []
  assert.equal(await resolvePodId({ podId: "pod_x", loadedPodId: "pod_y" }), "pod_x")
  assert.equal(await resolvePodId({ loadedPodId: "pod_y", projectDir: "/p" }), "pod_y")
  assert.equal(
    await resolvePodId({
      projectDir: "/p",
      lookup: async (dir) => { lookups.push(dir); return { pod: { id: "pod_z" } } },
    }),
    "pod_z",
  )
  assert.deepEqual(lookups, ["/p"])
  assert.equal(await resolvePodId({ projectDir: "/p", lookup: async () => { throw new Error("404") } }), null)
  assert.equal(await resolvePodId({}), null)
})

test("Goal 详情/计划审阅在 Pod 未加载时也能解析 Pod 并过滤 revision", () => {
  assert.match(goalDetail, /createPodIdResolver\(/)
  assert.match(goalDetail, /resolvePodIdForGoal\(/)
  assert.match(goalDetail, /props\.podId/)
  assert.match(goalDetail, /props\.projectDir/)
  assert.match(goalDetail, /probe\.revision === target/)
  assert.match(planReview, /createPodIdResolver\(/)
  assert.match(planReview, /resolvePodIdForPlan\(/)
  assert.match(planReview, /props\.podId/)
  assert.match(planReview, /probe\.revision === revision/)
})

test("方向/探针/变更警示样式存在且选中态可见", () => {
  assert.match(cssBlock(".mafw-pod-direction, .mafw-pod-probes {"), /display:\s*flex/)
  assert.match(cssBlock(".mafw-pod-direction-badge.is-attention {"), /var\(--warning\)/)
  assert.match(cssBlock('.mafw-pod-direction .mafw-pod-direction-option[aria-pressed="true"] {'), /var\(--accent-soft\)/)
  assert.match(cssBlock('.mafw-pod-direction .mafw-pod-direction-option[aria-pressed="true"] {'), /var\(--accent-border\)/)
  assert.match(cssBlock(".mafw-pod-probe-card {"), /display:\s*flex/)
  assert.match(cssBlock(".mafw-pod-probe-badge.is-refutes {"), /var\(--danger-dim\)/)
  assert.match(cssBlock(".mafw-pod-probe-badge.is-supports {"), /var\(--accent-soft\)/)
  assert.match(cssBlock(".mafw-plan-stale {"), /var\(--warning\)/)
  assert.match(cssBlock(".mafw-plan-stale {"), /border:/)
})

// ── Residual fixes (2026-11-03) ───────────────────────────────────────────

test("发送守卫用 resolvePodDetailCached（跨项目不信任旧 store，TTL 去重）", () => {
  assert.match(shell, /const resolveSendPod = async/)
  assert.match(shell, /resolvePodDetailCached\(\{/)
  assert.match(shell, /sameProject/)
  assert.match(shell, /const activeTechLeadGate = async/)
  assert.match(shell, /techLeadSendGate\(\{/)
  assert.match(podModel, /function techLeadSendGate/)
  assert.match(podModel, /mappedGoal && detail\.goals\?\.some/)
})

test("送守卫 fail-closed：tech_lead 或映射 Goal 存在但 Pod 不可解析 → 指引", () => {
  assert.match(shell, /role: tabSessionRole\(sessions\(\)\.find/)
  assert.match(podModel, /TECH_LEAD_UNRESOLVED_GUIDANCE/)
  const blocked = techLeadSendGate({ detail: null, sessionID: "ses_1", mappedGoalId: "g1", role: "tech_lead" })
  assert.equal(blocked.target, null)
  assert.equal(blocked.blocked, TECH_LEAD_UNRESOLVED_GUIDANCE)
  assert.equal(
    techLeadSendGate({ detail: null, sessionID: "ses_1", role: "tech_lead" }).blocked,
    TECH_LEAD_UNRESOLVED_GUIDANCE,
  )
  assert.deepEqual(techLeadSendGate({ detail: null, sessionID: "ses_1" }), { target: null, blocked: null })
  assert.deepEqual(techLeadSendGate({ detail: POD_DETAIL, sessionID: "ses_disc" }), {
    target: { podId: "pod_1", goalId: "g1" },
    blocked: null,
  })
  assert.match(techLeadSendGate({ detail: POD_DETAIL, sessionID: "ses_plan" }).blocked ?? "", /Tech Lead 讨论/)
})

test("方向裁定在 Dashboard 也能解析 Pod（不读 podStore.detail）", () => {
  assert.match(goalDetail, /const podId = await resolvePodIdForGoal\(\)/)
  assert.doesNotMatch(goalDetail, /async function decideDirection[\s\S]{0,200}podStore\.detail\(\)\?\.pod\.id/)
})

test("Pod 解析缓存按项目/podId/已加载 Pod 失效，且不缓存 null", () => {
  const base = { podId: "pod_1", projectDir: "/a", loadedProjectDir: "/a", loadedPodId: "pod_1" }
  assert.equal(podResolveKey(base), podResolveKey({ ...base }))
  assert.notEqual(podResolveKey(base), podResolveKey({ ...base, projectDir: "/b" }))
  assert.notEqual(podResolveKey(base), podResolveKey({ ...base, podId: "pod_2" }))
  assert.notEqual(podResolveKey(base), podResolveKey({ ...base, loadedPodId: "pod_2" }))
  assert.notEqual(podResolveKey(base), podResolveKey({ ...base, loadedProjectDir: "/b" }))
  assert.match(goalDetail, /createPodIdResolver\(/)
  assert.match(planReview, /createPodIdResolver\(/)
  assert.doesNotMatch(goalDetail, /podCache = \{ key, id \}/)
  assert.doesNotMatch(planReview, /podCache = \{ key, id \}/)
})

test("resolvePodDetailCached：null 只短期缓存（TTL 后重探）+ 并发去重", async () => {
  resetPodDetailCache()
  let calls = 0
  let clock = 1000
  const lookup = async () => { calls++; return null }
  try {
    assert.equal(await resolvePodDetailCached({ projectDir: "/p", lookup, now: () => clock, ttlMs: 5000 }), null)
    assert.equal(await resolvePodDetailCached({ projectDir: "/p", lookup, now: () => clock, ttlMs: 5000 }), null)
    assert.equal(calls, 1, "TTL 内的 null 命中缓存")
    clock += 6000
    assert.equal(await resolvePodDetailCached({ projectDir: "/p", lookup, now: () => clock, ttlMs: 5000 }), null)
    assert.equal(calls, 2, "TTL 过期后重新探测（不永久缓存 null）")
    resetPodDetailCache()
    let inflight = 0
    const slow = async () => { inflight++; return { pod: { id: "pod_1" } } as any }
    const [a, b] = await Promise.all([
      resolvePodDetailCached({ projectDir: "/q", lookup: slow }),
      resolvePodDetailCached({ projectDir: "/q", lookup: slow }),
    ])
    assert.equal(inflight, 1, "同一 key 并发只 lookup 一次")
    assert.equal(a?.pod.id, "pod_1")
    assert.equal(b?.pod.id, "pod_1")
  } finally {
    resetPodDetailCache()
  }
})

test("createPodIdResolver：只缓存命中，null 不缓存，并在飞请求去重", async () => {
  let calls = 0
  const resolver = createPodIdResolver({ lookup: async () => { calls++; return { pod: { id: "pod_hit" } } } })
  const missResolver = createPodIdResolver({ lookup: async () => { calls++; return { pod: { id: "" } } } })
  assert.equal(await resolver({ projectDir: "/a" }), "pod_hit")
  assert.equal(await resolver({ projectDir: "/a" }), "pod_hit")
  assert.equal(calls, 1, "命中只 lookup 一次")
  const before = calls
  assert.equal(await missResolver({ projectDir: "/b" }), null)
  assert.equal(await missResolver({ projectDir: "/b" }), null)
  assert.equal(calls, before + 2, "null 不缓存（每次重新探测）")
  let inflight = 0
  const slow = createPodIdResolver({ lookup: async () => { inflight++; return { pod: { id: "pod_slow" } } } })
  const [a, b] = await Promise.all([slow({ projectDir: "/c" }), slow({ projectDir: "/c" })])
  assert.equal(inflight, 1, "并发解析共享 in-flight")
  assert.equal(a, "pod_slow")
  assert.equal(b, "pod_slow")
})

test("PlanReview 刷新不依赖「已加载 pod id」前提（store 加载/项目变化会重跑）", () => {
  assert.match(planReview, /void podStore\.projectDir\(\)/)
  assert.match(planReview, /void podStore\.detail\(\)/)
  assert.match(planReview, /void loadProbes\(\)/)
  assert.doesNotMatch(planReview, /const podId = podStore\.detail\(\)\?\.pod\.id[\s\S]{0,40}if \(!podId/)
})

test("resolvePodDetail：已加载优先、失败 fail-open", async () => {
  const loaded = { pod: { id: "pod_loaded" } } as any
  assert.equal(await resolvePodDetail({ loaded, projectDir: "/a" }), loaded)
  assert.equal(
    (await resolvePodDetail({ projectDir: "/a", lookup: async () => ({ pod: { id: "pod_lookup" } }) as any }))?.pod.id,
    "pod_lookup",
  )
  assert.equal(await resolvePodDetail({ projectDir: "/a", lookup: async () => { throw new Error("404") } }), null)
  assert.equal(await resolvePodDetail({}), null)
})

test("异步发送守卫/路由：promise 版 sendBlocked 与 techLeadTarget 均生效", async () => {
  const calls: any[] = []
  ;(globalThis as any).window = {
    api: {
      mafw: {
        chat: { sendEnriched: async (req: any) => { calls.push(["chat", req]); return { sessionID: "s1" } } },
        pod: { sendTechLeadMessage: async (...args: any[]) => { calls.push(["pod", ...args]); return { revision: 1 } } },
      },
    },
  }
  const history = createInputHistory()
  const deps = (over: any) => ({
    sid: () => "s1",
    onCreateSession: async () => null,
    onSetUserMsgId: () => {},
    input: () => "继续",
    setInput: () => {},
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
    ...over,
  })
  try {
    await useSendMessage(deps({ sendBlocked: async () => "节点会话禁止发送" }) as any).sendMessage()
    assert.equal(calls.length, 0)
    await useSendMessage(deps({ techLeadTarget: async () => ({ podId: "pod_1", goalId: "g1" }) }) as any).sendMessage()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], "pod")
  } finally {
    delete (globalThis as any).window
  }
})
