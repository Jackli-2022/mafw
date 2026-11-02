import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { managerPhaseLabel } from "./rail-display"

const POLL_MS = 15000

const relTime = (ts?: number): string => {
  if (!ts) return ""
  const diff = Date.now() - ts
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

type Props = {
  managerSessionId: string | null
  managerUpdatedAt?: number
  online: boolean
  onSelectSession: (id: string, title: string, manager: boolean, metadata?: { mafw?: { role?: string } }) => void
  onOpenQuestions?: () => void
}

// 置顶单行（spec 2026-10-27 §6.2-3）：协调会话（Lead）本质是"置顶会话"，不是仪表盘卡。
// Lead 替换 Manager（spec 2026-11-02 §3.1）：kv/API 仍叫 manager-session，界面只称 Lead。
export function ManagerCard(props: Props) {
  const [goal, setGoal] = createSignal<any>(null)
  const [pending, setPending] = createSignal(0)

  const refresh = () => {
    if (!props.online) return
    window.api.mafw.goals.list().then((goals: any[]) => {
      const list = Array.isArray(goals) ? goals : []
      setGoal([...list].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null)
    }).catch(() => setGoal(null))
    window.api.mafw.questions.list().then((items: any[]) => {
      setPending(Array.isArray(items) ? items.length : 0)
    }).catch(() => setPending(0))
  }

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => { if (props.online) refresh() })

  const openManager = () => {
    // Lead 是隐藏会话（不在 /api/sessions 里）：metadata 必须显式带上，否则 tab 没有
    // 角色标记 → 新话题按钮消失、plan/build 与 agent 切换锁失效。
    if (props.managerSessionId) props.onSelectSession(props.managerSessionId, "Lead", true, { mafw: { role: "lead" } })
  }
  const openQuestions = () => {
    if (props.onOpenQuestions) props.onOpenQuestions()
    else openManager()
  }

  const progress = () => {
    const g = goal()
    if (!g || !g.totalWaves) return null
    return Math.min(100, Math.round(((g.currentWave || 0) / g.totalWaves) * 100))
  }

  return (
    <Show when={props.managerSessionId}>
      <div class="mafw-manager-row" classList={{ offline: !props.online }} onClick={openManager}>
        <span class="mafw-manager-row-dot" />
        <span class="mafw-manager-row-name">Lead</span>
        <span class="mafw-manager-row-phase">{goal() ? managerPhaseLabel(goal().phase) : "空闲"}</span>
        <Show when={pending() > 0}>
          <TooltipV2 value={`${pending()} 个待决问题`} openDelay={300}>
            <span
              class="mafw-manager-row-badge"
              onClick={e => { e.stopPropagation(); openQuestions() }}
            >{pending()}</span>
          </TooltipV2>
        </Show>
        <span class="mafw-manager-row-ago">{relTime(props.managerUpdatedAt)}</span>
        <Show when={progress() !== null}>
          <span class="mafw-manager-row-progress"><span style={{ width: `${progress()}%` }} /></span>
        </Show>
      </div>
    </Show>
  )
}
