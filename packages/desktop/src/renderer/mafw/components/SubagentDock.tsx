// RightDock「子代理」面板（spec 2026-10-21 §4.4）：当前会话的子代理行——状态行
// 粒度（agent + 标题 + 计时 + 状态），running 行 1s 计时跳；点击行进入子会话。
// 数据来自 subagent-store 全局单例（tracker 全局；这里按 activeSessionId 过滤显示）。
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { subagentRows } from "../subagent-store"
import { descendantRows } from "../subagent-tree"
import { formatDuration } from "../goal-timeline"
import type { SubagentRow, SubagentStatus } from "../subagent-tracker"

const STATUS_LABEL: Record<SubagentStatus, string> = {
  running: "运行中",
  completed: "完成",
  failed: "失败",
  aborted: "已中止",
}

export function SubagentDock(props: {
  activeSessionId: string | null
  onOpenSession: (id: string) => void
}) {
  const [now, setNow] = createSignal(Date.now())
  const rows = () => descendantRows(subagentRows(), props.activeSessionId ?? "")

  // 存在 running 行时每秒推进计时（模式同 ChatPane metaNow）。
  createEffect(() => {
    if (!rows().some(r => r.status === "running")) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(t))
  })

  const elapsed = (r: SubagentRow) =>
    formatDuration(r.status === "running" ? now() - r.startedAt : (r.endedAt ?? r.startedAt) - r.startedAt)

  const open = (id: string) => props.onOpenSession(id)

  return (
    <div class="mafw-subagent-dock">
      <div class="mafw-subagent-dock-hint">本会话子代理：状态实时刷新，点击行进入子会话查看全过程。</div>
      <Show when={rows().length > 0} fallback={
        <div class="mafw-subagent-dock-empty">
          <div class="mafw-subagent-dock-empty-icon">🤖</div>
          <div class="mafw-subagent-dock-empty-text">本会话暂无子代理</div>
          <div class="mafw-subagent-dock-empty-hint">agent 通过 task 工具派发子代理时会出现在这里</div>
        </div>
      }>
        <For each={rows()}>
          {(r) => (
            <div
              class={`mafw-subagent-row mafw-subagent-${r.status}`}
              role="button"
              tabIndex={0}
              title={r.title}
              style={{ "padding-left": `${8 + Math.max(0, (r.depth ?? 1) - 1) * 12}px` }}
              onClick={() => open(r.childID)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(r.childID) }
              }}
            >
              <span class="mafw-subagent-agent">{r.agent.charAt(0)}</span>
              <div class="mafw-subagent-main">
                <div class="mafw-subagent-title">{r.title || "子代理"}</div>
                <div class="mafw-subagent-meta">
                  <span class={`mafw-subagent-status mafw-subagent-status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  <span>{elapsed(r)}</span>
                </div>
              </div>
              <Show when={r.status === "running"}><span class="mafw-subagent-spinner" /></Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
