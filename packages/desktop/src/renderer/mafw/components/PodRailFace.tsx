// 左 dock 的鲸群面（名册优先，spec 2026-10-30-pod-left-rail §3.2）。
// 只做「看 + 贴条 + 立即提醒」；深操作留在右工作台「执行 › 鲸群」。
import { For, Show, createMemo, createSignal } from "solid-js"
import type { PodDetail, PodMessage } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import {
  buildMemberRows,
  canNotify,
  deliveryToast,
  podCounts,
  podEmptyState,
  type PodEmptyState,
} from "../pod-rail-face-model"
import { applyReadlineKey } from "./composer-readline"

const KINDS = [
  { value: "note", label: "备注" },
  { value: "request", label: "请求" },
  { value: "review", label: "验收" },
  { value: "decision", label: "决策" },
  { value: "escalation", label: "升级" },
]

export function PodRailFace(props: {
  detail: PodDetail | null
  messages: PodMessage[]
  loading: boolean
  unsupported: boolean
  isWorktree: boolean
  selfMemberId: string | null
  sessionTitleOf?: (sessionId: string) => string | null
  onOpenSession: (sessionId: string) => void
  onOpenGoal: (goalId: string) => void
  onOpenPanel: (panel: "tasks" | "inbox") => void
  onSend: (input: { toMemberId: string | null; kind: string; body: string; notify: boolean }) => Promise<string>
  onCreate: () => void
}) {
  const [kind, setKind] = createSignal("note")
  const [toMemberId, setToMemberId] = createSignal("__all__")
  const [body, setBody] = createSignal("")
  const [notify, setNotify] = createSignal(false)
  const [sending, setSending] = createSignal(false)

  const emptyState = createMemo<PodEmptyState>(() =>
    podEmptyState({ hasPod: !!props.detail, unsupported: props.unsupported, isWorktree: props.isWorktree }))
  const rows = createMemo(() => (props.detail
    ? buildMemberRows(props.detail, (id) => props.sessionTitleOf?.(id) ?? null)
    : []))
  const counts = createMemo(() => (props.detail
    ? podCounts(props.detail, props.messages, props.selfMemberId)
    : { review: 0, todo: 0, inbox: 0 }))
  const activeGoal = createMemo(() => props.detail?.goals.find((goal) => goal.status === "active") ?? null)
  const lead = createMemo(() => props.detail?.members.find((member) => member.role === "lead") ?? null)
  const kindOption = createMemo(() => KINDS.find((item) => item.value === kind()) ?? KINDS[0])
  const recipients = createMemo(() => [
    { value: "__all__", label: "广播" },
    ...(props.detail?.members ?? []).map((member) => ({ value: member.id, label: member.displayName })),
  ])
  const recipientOption = createMemo(() =>
    recipients().find((item) => item.value === toMemberId()) ?? recipients()[0])
  const targetRow = createMemo(() => rows().find((row) => row.id === toMemberId()) ?? null)
  const notifyEnabled = createMemo(() => canNotify(
    toMemberId() === "__all__" ? null : toMemberId(),
    !!targetRow()?.sessionId,
  ))

  const send = async () => {
    const text = body().trim()
    if (!text || sending() || !lead()) return
    setSending(true)
    try {
      const toast = await props.onSend({
        toMemberId: toMemberId() === "__all__" ? null : toMemberId(),
        kind: kind(),
        body: text,
        notify: notify() && notifyEnabled(),
      })
      setBody("")
      setNotify(false)
      showToastV2({ description: toast, duration: 2500 })
    } catch (err: any) {
      showToastV2({ description: `发送失败：${String(err?.message ?? err).slice(0, 60)}`, duration: 3000 } as any)
    } finally {
      setSending(false)
    }
  }

  const onComposerKey = (event: KeyboardEvent) => {
    const el = event.currentTarget as HTMLTextAreaElement
    if (event.key === "Escape") {
      if (body().length > 0) {
        event.preventDefault()
        event.stopPropagation()
        setBody("")
      }
      return
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      void send()
      return
    }
    const next = applyReadlineKey(
      { value: el.value, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 },
      event.key,
      { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey },
    )
    if (!next) return
    event.preventDefault()
    setBody(next.value)
    queueMicrotask(() => {
      el.value = next.value
      el.setSelectionRange(next.start, next.end)
    })
  }

  return (
    <div class="mafw-pod-rail-face">
      <Show when={emptyState() === "unsupported"}>
        <div class="mafw-pod-rail-empty">当前 gateway 不支持鲸群，请升级</div>
      </Show>
      <Show when={emptyState() === "worktree"}>
        <div class="mafw-pod-rail-empty">worktree 会话不绑定鲸群，请在主项目打开</div>
      </Show>
      <Show when={emptyState() === "create"}>
        <div class="mafw-pod-rail-empty">
          <p>这个项目还没有鲸群</p>
          <ButtonV2 variant="outline" size="small" onClick={props.onCreate}>创建鲸群</ButtonV2>
        </div>
      </Show>

      <Show when={emptyState() === "ready"}>
        <div class="mafw-pod-rail-members">
          <For each={rows()}>
            {(row) => (
              <div class="mafw-pod-rail-member" classList={{ active: !!row.sessionId }}>
                <span class={`mafw-pod-rail-dot ${row.dotClass}`} aria-hidden="true" />
                <div class="mafw-pod-rail-member-main">
                  <div class="mafw-pod-rail-member-top">
                    <span class="mafw-pod-rail-member-name">{row.displayName}</span>
                    <span class="mafw-pod-rail-member-agent">{row.agentName}</span>
                    <span class="mafw-pod-rail-member-status">{row.statusLabel}</span>
                  </div>
                  <div class="mafw-pod-rail-member-action">{row.action}</div>
                </div>
                <TooltipV2 value={row.sessionId ? "打开会话" : "暂无活跃会话"} openDelay={300}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    icon="square-arrow-top-right"
                    aria-label={`打开 ${row.displayName} 的会话`}
                    disabled={!row.sessionId}
                    onClick={() => { if (row.sessionId) props.onOpenSession(row.sessionId) }}
                  />
                </TooltipV2>
              </div>
            )}
          </For>
        </div>

        <Show when={activeGoal()}>
          {(goal) => (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-pod-rail-goal"
              aria-label={`打开 goal ${goal().goalId}`}
              onClick={() => props.onOpenGoal(goal().goalId)}
            >
              <span class="mafw-pod-rail-goal-id">{goal().goalId.slice(0, 12)}</span>
              <span class="mafw-pod-rail-goal-state">{goal().status}</span>
            </ButtonV2>
          )}
        </Show>

        <div class="mafw-pod-rail-counts">
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("tasks")}>待审 {counts().review}</ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("tasks")}>待办 {counts().todo}</ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("inbox")}>邮箱 {counts().inbox}</ButtonV2>
        </div>

        <Show when={lead()} fallback={<div class="mafw-pod-rail-empty">缺少 Lead 成员，无法发送</div>}>
          <div class="mafw-pod-rail-compose">
            <div class="mafw-pod-rail-route">
              <SelectV2
                current={kindOption()}
                value={(item: { value: string }) => item.value}
                label={(item: { label: string }) => item.label}
                onSelect={(item: any) => setKind(item?.value ?? "note")}
                options={KINDS}
              />
              <SelectV2
                current={recipientOption()}
                value={(item: { value: string }) => item.value}
                label={(item: { label: string }) => item.label}
                onSelect={(item: any) => { setToMemberId(item?.value ?? "__all__"); setNotify(false) }}
                options={recipients()}
              />
            </div>
            <textarea
              class="mafw-pod-rail-input"
              value={body()}
              placeholder="以 Lead 身份发送…"
              onInput={(event) => setBody(event.currentTarget.value)}
              onKeyDown={onComposerKey}
            />
            <div class="mafw-pod-rail-actions">
              <TooltipV2
                value={notifyEnabled() ? "回合结束后优先送达" : (toMemberId() === "__all__" ? "广播不支持立即提醒" : "对方暂无活跃会话")}
                openDelay={300}
              >
                <SwitchV2
                  checked={notify()}
                  disabled={!notifyEnabled()}
                  hideLabel
                  onChange={(checked: boolean) => setNotify(checked)}
                >
                  立即提醒
                </SwitchV2>
              </TooltipV2>
              <span class="mafw-pod-rail-hint">{notify() && notifyEnabled() ? "立即提醒" : "Enter 发送"}</span>
              <ButtonV2
                variant="outline"
                size="small"
                disabled={!body().trim() || sending()}
                onClick={() => void send()}
              >
                {sending() ? "发送中…" : "发送"}
              </ButtonV2>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}
