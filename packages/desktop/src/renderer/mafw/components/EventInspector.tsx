// Dev 事件检查器：Ctrl+Shift+E 呼出的 SSE trace 浮层。
// 每行 = 一帧事件 + 它在 MafwShell onmessage 里被哪个分支消费；
// branch 为 "miss"（未接线未知事件）的行红色高亮——这就是"显示不出来"
// 问题的可视化答案。非 dev 工具依赖，纯 renderer 内存数据（event-trace.ts）。
import { createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { getTrace, clearTrace, type TraceEntry } from "../event-trace"

const fmtTime = (at: number): string => {
  const d = new Date(at)
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function EventInspector(props: { onClose: () => void }) {
  const [entries, setEntries] = createSignal<TraceEntry[]>([])
  const [filter, setFilter] = createSignal<"all" | "miss">("all")
  let timer: ReturnType<typeof setInterval> | null = null
  onMount(() => {
    timer = setInterval(() => setEntries(getTrace()), 500)
    onCleanup(() => { if (timer) clearInterval(timer) })
  })
  const visible = () => {
    const t = entries()
    return filter() === "miss" ? t.filter(e => e.branch === "miss") : t
  }
  const missCount = () => entries().filter(e => e.branch === "miss").length
  return (
    <div class="mafw-event-inspector" style={{
      position: "fixed", right: "12px", bottom: "12px", "z-index": 9999,
      width: "520px", "max-height": "60vh", display: "flex", "flex-direction": "column",
      background: "var(--background, #16161a)", color: "var(--text, #e8e8ea)",
      border: "1px solid var(--border, #333)", "border-radius": "8px",
      "box-shadow": "0 8px 32px rgba(0,0,0,.45)", "font-family": "monospace", "font-size": "12px",
    }}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "8px 10px", "border-bottom": "1px solid var(--border, #333)" }}>
        <strong>SSE 事件链路</strong>
        <span style={{ opacity: 0.6 }}>({entries().length}/100)</span>
        <Show when={missCount() > 0}>
          <span style={{ color: "#ff6b6b" }}>⚠ miss ×{missCount()}</span>
        </Show>
        <div style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
          <ButtonV2 variant={filter() === "all" ? "contrast" : "ghost"} size="small" onClick={() => setFilter("all")}>全部</ButtonV2>
          <ButtonV2 variant={filter() === "miss" ? "contrast" : "ghost"} size="small" onClick={() => setFilter("miss")}>仅 miss</ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => { clearTrace(); setEntries([]) }}>清空</ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={props.onClose} aria-label="关闭事件检查器">✕</ButtonV2>
        </div>
      </div>
      <div style={{ overflow: "auto", padding: "4px 0" }}>
        <Show
          when={visible().length > 0}
          fallback={<div style={{ padding: "16px 10px", opacity: 0.5 }}>暂无事件——发一条消息试试</div>}
        >
          <For each={visible()}>
            {(e) => (
              <div
                style={{
                  display: "grid", "grid-template-columns": "92px 1fr 88px 150px", gap: "8px",
                  padding: "2px 10px",
                  background: e.branch === "miss" ? "rgba(255,107,107,.14)" : undefined,
                  color: e.branch === "miss" ? "#ff6b6b" : undefined,
                }}
              >
                <span style={{ opacity: 0.6 }}>{fmtTime(e.at)}</span>
                <span style={{ "word-break": "break-all" }}>{e.type}</span>
                <span style={{ opacity: 0.6 }}>{e.sessionID ? e.sessionID.slice(-8) : "—"}</span>
                <span>{e.branch}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
