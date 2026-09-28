// session-tree：多项目懒加载会话树的纯逻辑（Rail 重构 v6 §0b）。
// manager 置顶，普通会话按日期分组（沿用 Rail 现有 groupLabel 语义），
// worktree 徽标复用 worktree-label 的判定（<base>-wt-<slug>）。
import { worktreeBadge } from "./worktree-label"

type SessionInfo = {
  id: string
  title?: string
  directory?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
}

export type SessionNode = {
  id: string
  title: string
  updated: number
  manager: boolean
  worktree: string | null
}
export type ProjectNode = {
  projectID: string
  name: string
  current: boolean
  manager: SessionNode | null
  groups: { label: string; items: SessionNode[] }[]
}

const DAY = 86400000
const dayStart = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const groupLabel = (ts: number, now: number): string => {
  const diffDays = Math.round((dayStart(now) - dayStart(ts)) / DAY)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays < 7) return "过去 7 天"
  const d = new Date(ts)
  const y = d.getFullYear()
  return y === new Date(now).getFullYear() ? `${d.getMonth() + 1}月` : `${y}年${d.getMonth() + 1}月`
}

const toNode = (s: SessionInfo, projectDir: string, manager: boolean): SessionNode => ({
  id: s.id,
  title: s.title?.trim() || "New conversation",
  updated: s.time?.updated || s.time?.created || 0,
  manager,
  worktree: worktreeBadge(s.directory, projectDir),
})

/** 逐项目分页（v6 修复）：恢复被重写丢失的 limit，避免一次渲染数千会话行。 */
export const RAIL_PAGE_SIZE = 100

export function pageGroups(
  groups: ProjectNode["groups"],
  limit: number,
): { groups: ProjectNode["groups"]; total: number; hasMore: boolean } {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (limit >= total) return { groups, total, hasMore: false }
  const out: ProjectNode["groups"] = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    const items = g.items.slice(0, left)
    out.push({ label: g.label, items })
    left -= items.length
  }
  return { groups: out, total, hasMore: true }
}

export function buildSessionTree(
  projects: { id: string; name?: string; worktree?: string }[],
  sessionsByProject: Record<string, SessionInfo[]>,
  currentProjectID: string | null,
  now: number = Date.now(),
): ProjectNode[] {
  return (projects ?? []).map((p) => {
    const pid = p.worktree || p.id
    const projectDir = p.worktree || p.id || ""
    const list = sessionsByProject[pid] ?? []
    const sorted = [...list].sort(
      (a, b) => (b.time?.updated || b.time?.created || 0) - (a.time?.updated || a.time?.created || 0),
    )
    const mgr = sorted.find((s) => s.metadata?.mafw?.role === "manager") ?? null
    const rest = sorted.filter((s) => s !== mgr)
    const groups: { label: string; items: SessionNode[] }[] = []
    for (const s of rest) {
      const label = groupLabel(s.time?.updated || s.time?.created || now, now)
      const last = groups[groups.length - 1]
      const node = toNode(s, projectDir, false)
      if (last && last.label === label) last.items.push(node)
      else groups.push({ label, items: [node] })
    }
    return {
      projectID: pid,
      name: p.name || p.id,
      current: pid === currentProjectID,
      manager: mgr ? toNode(mgr, projectDir, true) : null,
      groups,
    }
  })
}
