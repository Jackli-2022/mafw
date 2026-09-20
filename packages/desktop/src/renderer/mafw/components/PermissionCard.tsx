// @ts-nocheck
import { createSignal, createMemo, createEffect, Show, For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { flowCardInitialExpanded } from "./flow-card-placement"
import { autoBadgeText } from "./permission-card-mapping"

export type PermissionCardData = {
  id: string
  sessionID: string
  agentName: string
  status: "pending" | "allowed-once" | "allowed-always" | "denied" | "expired"
  risk: "medium" | "high"
  /** gateway 策略已自动处置的卡（非交互记录）：'auto'=auto-approve，'internal'=内部会话 fail-safe 拒绝 */
  autoResolved?: "auto" | "internal"
  action: {
    type: string
    title: string
    payload: string
    dangerousParts?: string[]
  }
  impact?: string
  createdAt: number
  /** The assistant message id whose tool call triggered this request. */
  messageID?: string
  /** The tool call id (ToolPart.callID) that triggered this request — inline anchor. */
  callID?: string
}

function StatusBadge(props: { status: string; autoResolved?: "auto" | "internal" }) {
  const auto = autoBadgeText(props.autoResolved)
  if (auto) {
    return <span class={`mafw-flow-badge ${props.autoResolved === "internal" ? "mafw-flow-badge-danger" : "mafw-flow-badge-ok"}`}>{auto}</span>
  }
  if (props.status === "allowed-once" || props.status === "allowed-always") {
    return <span class="mafw-flow-badge mafw-flow-badge-ok">{props.status === "allowed-always" ? "始终允许" : "已允许"}</span>
  }
  if (props.status === "denied" || props.status === "expired") {
    return <span class="mafw-flow-badge mafw-flow-badge-danger">已拒绝</span>
  }
  return (
    <span class="mafw-flow-badge mafw-flow-badge-wait">
      <span class="mafw-flow-pulse" />
      等待确认
    </span>
  )
}

export function PermissionCard(props: {
  data: PermissionCardData
  queueLength?: number
  keyboardOwner?: boolean
  onAllowOnce?: () => void
  onAllowAlways?: () => void
  /** 持久允许 · 此前缀（always + persist: 'prefix'，patterns 空时 gateway 兜底落工具级） */
  onAllowPersist?: () => void
  /** 持久允许 · 此工具（always + persist: 'tool'，工具级规则） */
  onAllowPersistTool?: () => void
  onDeny?: (note?: string) => void
}) {
  const [confirmArmed, setConfirmArmed] = createSignal(false)
  const [noteOpen, setNoteOpen] = createSignal(false)
  const [note, setNote] = createSignal("")
  // 已处理的卡默认收起为一行；初始 pending 的卡回答后不自动收起（不抽走视图）。
  const [expanded, setExpanded] = createSignal(flowCardInitialExpanded(props.data.status))

  let armTimer: ReturnType<typeof setTimeout> | null = null

  const highRisk = () => props.data.risk === "high"

  const allowOnce = () => {
    if (props.data.status !== "pending") return
    if (highRisk() && !confirmArmed()) {
      setConfirmArmed(true)
      if (armTimer) clearTimeout(armTimer)
      armTimer = setTimeout(() => setConfirmArmed(false), 1500)
      return
    }
    props.onAllowOnce?.()
  }

  const deny = (withNote: boolean) => {
    if (props.data.status !== "pending") return
    props.onDeny?.(withNote ? (note().trim() || undefined) : undefined)
  }

  // Keyboard: Y/Enter allow-once, A allow-always, N open note, Esc deny.
  // Only the keyboard-owner pending card captures global keys (no collisions
  // when several pending cards coexist).
  createEffect(() => {
    if (props.data.status !== "pending" || !props.keyboardOwner) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        if (noteOpen() && e.key === "Enter") { e.preventDefault(); deny(true) }
        else if (noteOpen() && e.key === "Escape") { e.preventDefault(); deny(false) }
        return
      }
      const k = e.key.toLowerCase()
      if (k === "y" || e.key === "Enter") { e.preventDefault(); allowOnce() }
      else if (k === "a") { e.preventDefault(); props.onAllowAlways?.() }
      else if (k === "p") { e.preventDefault(); props.onAllowPersist?.() }
      else if (k === "t") { e.preventDefault(); props.onAllowPersistTool?.() }
      else if (k === "n") { e.preventDefault(); setNoteOpen(true) }
      else if (e.key === "Escape") { e.preventDefault(); deny(false) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const payloadParts = createMemo(() => {
    const payload = props.data.action.payload
    const parts = props.data.action.dangerousParts || []
    if (parts.length === 0) return [{ text: payload, danger: false }]
    const out: { text: string; danger: boolean }[] = []
    let rest = payload
    for (const part of parts) {
      const idx = rest.indexOf(part)
      if (idx < 0) continue
      if (idx > 0) out.push({ text: rest.slice(0, idx), danger: false })
      out.push({ text: part, danger: true })
      rest = rest.slice(idx + part.length)
    }
    if (rest) out.push({ text: rest, danger: false })
    return out.length ? out : [{ text: payload, danger: false }]
  })

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(props.data.action.payload)
      showToastV2({ description: "已复制", duration: 2000 })
    } catch { /* ignore */ }
  }

  return (
    <section
      class="mafw-flow-card"
      classList={{
        "mafw-flow-card-dimmed": props.data.status === "denied" || props.data.status === "expired",
        "mafw-flow-card-resolved": props.data.status !== "pending",
      }}
    >
      <div class="mafw-flow-leftbar" classList={{ danger: highRisk() }} />
      {/* Collapsed one-liner (resolved, default) — click/Enter expands */}
      <Show when={expanded()} fallback={
        <div
          class="mafw-flow-collapsed"
          role="button"
          tabIndex="0"
          onClick={() => setExpanded(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(true) } }}
        >
          <span class="mafw-flow-icon mafw-flow-icon-danger" classList={{ danger: highRisk() }}>🛡</span>
          <span class="mafw-flow-summary-check" classList={{ denied: props.data.status === "denied" || props.data.status === "expired" }}>
            {props.data.status === "denied" || props.data.status === "expired" ? "✗" : "✓"}
          </span>
          <span class="mafw-flow-summary-text">{props.data.action.title}</span>
          <span class="mafw-flow-summary-payload">{props.data.action.payload}</span>
          <span class="mafw-flow-collapsed-chevron">▸</span>
        </div>
      }>
      {/* Header */}
      <header class="mafw-flow-header">
        <span class="mafw-flow-icon mafw-flow-icon-danger" classList={{ danger: highRisk() }}>🛡</span>
        <span class="mafw-flow-title">{props.data.agentName || "Agent"} 请求权限</span>
        <span class={`mafw-flow-risk mafw-flow-risk-${highRisk() ? "high" : "med"}`}>{highRisk() ? "高风险" : "中风险"}</span>
        <div class="mafw-flow-badge-wrap">
          <StatusBadge status={props.data.status} autoResolved={props.data.autoResolved} />
          <Show when={(props.queueLength || 0) > 0}>
            <span class="mafw-flow-badge mafw-flow-badge-muted">还有 {props.queueLength} 项</span>
          </Show>
          <Show when={props.data.status !== "pending"}>
            <span
              class="mafw-flow-collapse-toggle"
              role="button"
              tabIndex="0"
              title="收起"
              onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setExpanded(false) } }}
            >▾</span>
          </Show>
        </div>
      </header>

      <Show when={props.data.status === "pending"} fallback={
        /* collapsed summary */
        <div class="mafw-flow-summary">
          <div class="mafw-flow-summary-row">
            <span class="mafw-flow-summary-check" classList={{ denied: props.data.status === "denied" || props.data.status === "expired" }}>
              {props.data.status === "denied" || props.data.status === "expired" ? "✗" : "✓"}
            </span>
            <span class="mafw-flow-summary-text">{props.data.action.title}</span>
            <span class="mafw-flow-summary-payload">{props.data.action.payload}</span>
          </div>
        </div>
      }>
        {/* Action */}
        <h3 class="mafw-flow-qtitle">{props.data.action.title}</h3>
        <div class="mafw-flow-payload">
          <ButtonV2 variant="ghost" size="small" class="mafw-flow-copy" onClick={copyPayload} aria-label="复制命令">复制</ButtonV2>
          <code class="mafw-flow-payload-code">
            <For each={payloadParts()}>
              {(p) => <span classList={{ "mafw-flow-danger-text": p.danger }}>{p.text}</span>}
            </For>
          </code>
        </div>
        <Show when={props.data.impact}>
          <p class="mafw-flow-impact">{props.data.impact}</p>
        </Show>

        {/* Deny note */}
        <div class="mafw-flow-custom" style={{ "grid-template-rows": noteOpen() ? "1fr" : "0fr" }}>
          <div class="mafw-flow-custom-inner">
            <input
              type="text"
              class="mafw-flow-custom-input"
              placeholder="告诉 agent 为什么（可选），Enter 确认拒绝"
              value={note()}
              onInput={e => setNote(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); deny(true) } }}
            />
          </div>
        </div>

        {/* Footer */}
        <footer class="mafw-flow-footer">
          <span class="mafw-flow-keyhint">Y 允许一次 · A 本会话 · P 记此前缀 · T 记此工具 · N 拒绝</span>
          <div class="mafw-flow-footer-actions">
            <ButtonV2 variant="ghost" size="small" class="mafw-flow-btn-ghost" onClick={() => setNoteOpen(true)}>
              拒绝
            </ButtonV2>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-flow-btn-ghost"
              aria-label="持久允许此前缀（跨会话记住命令前缀）"
              onClick={() => props.onAllowPersist?.()}
            >
              记此前缀
            </ButtonV2>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-flow-btn-ghost"
              aria-label="持久允许此工具（跨会话记住整个工具）"
              onClick={() => props.onAllowPersistTool?.()}
            >
              记此工具
            </ButtonV2>
            <ButtonV2 variant="outline" size="small" class="mafw-flow-btn-always" onClick={() => props.onAllowAlways?.()}>
              本会话始终允许
            </ButtonV2>
            <ButtonV2
              variant="contrast"
              size="small"
              class="mafw-flow-btn-primary"
              classList={{ "mafw-flow-btn-danger": highRisk() }}
              onClick={allowOnce}
            >
              {highRisk() && confirmArmed() ? "确认执行？" : "允许一次"}
            </ButtonV2>
          </div>
        </footer>
      </Show>
      </Show>
    </section>
  )
}
