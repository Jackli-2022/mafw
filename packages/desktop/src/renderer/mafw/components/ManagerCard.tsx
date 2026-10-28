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
  onSelectSession: (id: string, title: string, manager: boolean) => void
  onOpenQuestions?: () => void
}

// 置顶单行（spec 2026-10-27 §6.2-3）：Manager 本质是"置顶会话"，不是仪表盘卡。
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
    if (props.managerSessionId) props.onSelectSession(props.managerSessionId, "Manager", true)
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
        <span class="mafw-manager-row-name">Manager</span>
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
