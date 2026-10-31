import { For, Show, createMemo, createSignal } from "solid-js"
import type { PodDetail, PodMessage } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { podMemberName, podMessageDeliveryLabel, podMessageProtocolLabel, podShortTime } from "../pod-model"
import { canNotify } from "../pod-rail-face-model"

const KINDS = [
  { value: "note", label: "备注" },
  { value: "request", label: "请求" },
  { value: "review", label: "验收" },
  { value: "decision", label: "决策" },
  { value: "escalation", label: "升级" },
]

export function PodInbox(props: {
  detail: PodDetail
  messages: PodMessage[]
  busy: boolean
  onSend: (input: { kind: string; toMemberId: string | null; body: string; notify: boolean }) => Promise<string>
  onRead?: (messageId: string) => void
}) {
  const [kind, setKind] = createSignal("note")
  const [toMemberId, setToMemberId] = createSignal("__all__")
  const [body, setBody] = createSignal("")
  const [notify, setNotify] = createSignal(false)
  const [sending, setSending] = createSignal(false)

  const lead = createMemo(() => props.detail.members.find((member) => member.role === "lead") ?? null)
  const kindOption = createMemo(() => KINDS.find((item) => item.value === kind()) ?? KINDS[0])
  const recipients = createMemo(() => [
    { value: "__all__", label: "广播" },
    ...props.detail.members.map((member) => ({ value: member.id, label: member.displayName })),
  ])
  const recipientOption = createMemo(() =>
    recipients().find((item) => item.value === toMemberId()) ?? recipients()[0],
  )
  const hasActiveSession = createMemo(() => {
    const target = toMemberId()
    if (target === "__all__") return false
    return props.detail.sessions.some((session) => session.memberId === target && !session.endedAt)
  })
  const notifyEnabled = createMemo(() => canNotify(
    toMemberId() === "__all__" ? null : toMemberId(),
    hasActiveSession(),
  ))
  const notifyHint = createMemo(() => {
    if (toMemberId() === "__all__") return "广播不支持立即提醒"
    if (!hasActiveSession()) return "对方暂无活跃会话，消息会在下次派活时送达"
    return "回合结束后优先送达"
  })

  const send = async () => {
    const text = body().trim()
    const from = lead()
    if (!text || !from || sending() || props.busy) return
    setSending(true)
    try {
      const toast = await props.onSend({
        kind: kind(),
        toMemberId: toMemberId() === "__all__" ? null : toMemberId(),
        body: text,
        notify: notify() && notifyEnabled(),
      })
      setBody("")
      setNotify(false)
      showToastV2({ description: toast, duration: 2500 })
    } catch (err: any) {
      showToastV2({ description: `发送失败：${String(err?.message ?? err).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="mafw-pod-inbox">
      <div class="mafw-pod-section-head">
        <span>邮箱</span>
        <span class="mafw-pod-section-count">{props.messages.length} 条</span>
      </div>

      <div class="mafw-pod-message-list">
        <Show when={props.messages.length > 0} fallback={<div class="mafw-pod-empty-line">暂无消息</div>}>
          <For each={props.messages}>
            {(message) => (
              <div
                class="mafw-pod-message mafw-pod-message-row"
                classList={{ unread: !message.readAt }}
                role="button"
                tabIndex={0}
                aria-label={`标记已读：${message.body.slice(0, 40)}`}
                onClick={() => { if (!message.readAt) props.onRead?.(message.id) }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  if (!message.readAt) props.onRead?.(message.id)
                }}
              >
                <div class="mafw-pod-message-head">
                  <span class="mafw-pod-message-route">
                    {podMemberName(props.detail, message.fromMemberId)} → {message.toMemberId ? podMemberName(props.detail, message.toMemberId) : "广播"}
                  </span>
                  <span class="mafw-pod-message-kind">{KINDS.find((item) => item.value === message.kind)?.label ?? message.kind}</span>
                  <Show when={podMessageProtocolLabel(message)}>
                    <span class="mafw-pod-message-protocol">{podMessageProtocolLabel(message)}</span>
                  </Show>
                  <Show when={podMessageDeliveryLabel(message)}>
                    <span class="mafw-pod-message-delivery">{podMessageDeliveryLabel(message)}</span>
                  </Show>
                  <span class="mafw-pod-message-time">{podShortTime(message.createdAt, Date.now())}</span>
                </div>
                <div class="mafw-pod-message-body">{message.body}</div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show
        when={lead()}
        fallback={<div class="mafw-pod-empty-line">缺少 Lead 成员，无法发送</div>}
      >
        <div class="mafw-pod-inbox-compose">
          <div class="mafw-pod-inbox-route">
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
              onSelect={(item: any) => setToMemberId(item?.value ?? "__all__")}
              options={recipients()}
            />
          </div>
          <textarea
            class="mafw-pod-inbox-input"
            value={body()}
            placeholder="以 Lead 身份发送…"
            onInput={(event) => setBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div class="mafw-pod-inbox-actions">
            <TooltipV2 value={notifyHint()} openDelay={300}>
              <span class="mafw-pod-inbox-notify">
                <SwitchV2
                  checked={notify()}
                  disabled={!notifyEnabled()}
                  size="small"
                  hideLabel
                  onChange={(checked: boolean) => setNotify(checked)}
                >
                  立即提醒
                </SwitchV2>
                <span class="mafw-pod-inbox-notify-label">立即提醒</span>
              </span>
            </TooltipV2>
            <span class="mafw-pod-inbox-hint">以 Lead 身份发送 · Ctrl+Enter</span>
            <ButtonV2
              variant="outline"
              size="small"
              disabled={!body().trim() || sending() || props.busy}
              onClick={() => void send()}
            >
              {sending() ? "发送中…" : "发送"}
            </ButtonV2>
          </div>
        </div>
      </Show>
    </div>
  )
}
