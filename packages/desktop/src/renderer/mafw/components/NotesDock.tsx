// @ts-nocheck
// Sticky note board dock: mirrors the <note-board> block injected into the
// agent's recall context, so the user can see (and manage) what the agent is
// reminded of every turn. Board-level expiry only — removing a note never
// deletes the underlying memory unless the user explicitly presses 删除.
import { createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"

interface StickyNote {
  id: string
  type: string
  primary_abstraction: string
  memory_value: string
  energy: number
  created_at?: string
  sticky_until?: string
}

function daysLeft(until?: string): number | null {
  if (!until) return null
  const ms = new Date(until).getTime()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400e3))
}

function fmtDate(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function NotesDock() {
  const [data, setData] = createSignal<{ entries: StickyNote[]; budget: { max: number; maxChars: number; used: number } } | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [busyId, setBusyId] = createSignal<string | null>(null)

  const fetchNotes = async () => {
    setLoading(true)
    try {
      const r = await window.api.mafw.memory.listSticky()
      setData(r)
    } catch (e) {
      console.warn("[NotesDock] fetch failed:", e?.message)
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    fetchNotes()
    const timer = setInterval(fetchNotes, 15000)
    onCleanup(() => clearInterval(timer))
  })

  const act = async (note: StickyNote, action: "renew" | "unstick" | "delete") => {
    setBusyId(note.id)
    try {
      if (action === "renew") {
        await window.api.mafw.memory.setSticky(note.id, true, 7)
        showToastV2({ description: "已续期 7 天", duration: 2500 })
      } else if (action === "unstick") {
        await window.api.mafw.memory.setSticky(note.id, false)
        showToastV2({ description: "已下架（记忆本体保留）", duration: 2500 })
      } else {
        await window.api.mafw.memory.delete(note.id)
        showToastV2({ description: "记忆已删除", duration: 2500 })
      }
      await fetchNotes()
    } catch (e) {
      showToastV2({ description: `操作失败: ${e?.message || String(e)}`, duration: 4000 })
    } finally {
      setBusyId(null)
    }
  }

  const entries = () => data()?.entries ?? []
  const budget = () => data()?.budget

  return (
    <div class="mafw-notes-dock">
      <div class="mafw-notes-dock-toolbar">
        <span class="mafw-notes-dock-title">便签板</span>
        <Show when={budget()}>
          <span class="mafw-notes-dock-budget">{budget().used}/{budget().max}</span>
        </Show>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" onClick={fetchNotes} aria-label="刷新便签板">⟳</ButtonV2>
        </TooltipV2>
      </div>
      <div class="mafw-notes-dock-hint">
        用户叮嘱的备忘，每轮提醒给 agent；到期自动下架，记忆本体保留。
      </div>
      <Show when={!loading() || entries().length > 0} fallback={
        <div class="mafw-notes-dock-empty"><LoaderV2 /></div>
      }>
        <Show when={entries().length > 0} fallback={
          <div class="mafw-notes-dock-empty">
            <div class="mafw-notes-dock-empty-icon">📝</div>
            <div class="mafw-notes-dock-empty-text">板上没有便签</div>
            <div class="mafw-notes-dock-empty-hint">对 agent 说"记下来"即可上板</div>
          </div>
        }>
          <For each={entries()}>
            {(note) => {
              const left = daysLeft(note.sticky_until)
              return (
                <div class="mafw-notes-card" classList={{ urgent: left !== null && left <= 1 }}>
                  <div class="mafw-notes-card-text">{note.memory_value}</div>
                  <div class="mafw-notes-card-meta">
                    <span class="mafw-notes-card-type">[{note.type}]</span>
                    <Show when={fmtDate(note.created_at)}>
                      <span>{fmtDate(note.created_at)} 写入</span>
                    </Show>
                    <Show when={left !== null}>
                      <span class="mafw-notes-card-left" classList={{ urgent: left <= 1 }}>
                        {left <= 0 ? "今天到期" : `剩 ${left} 天`}
                      </span>
                    </Show>
                  </div>
                  <div class="mafw-notes-card-actions">
                    <ButtonV2 variant="ghost" size="small" disabled={busyId() === note.id} onClick={() => act(note, "renew")}>续期 +7天</ButtonV2>
                    <ButtonV2 variant="ghost" size="small" disabled={busyId() === note.id} onClick={() => act(note, "unstick")}>下架</ButtonV2>
                    <TooltipV2 value="删除记忆本体（不可恢复）" openDelay={300}>
                      <ButtonV2 variant="ghost" size="small" disabled={busyId() === note.id} onClick={() => act(note, "delete")}>删除</ButtonV2>
                    </TooltipV2>
                  </div>
                </div>
              )
            }}
          </For>
        </Show>
      </Show>
    </div>
  )
}
