import { genericSections, parseOut, rawSection, s, trunc, type Section, type ToolBadge } from "./extract"

function joinTruthy(parts: Array<string | undefined>): string | undefined {
  const x = parts.filter(Boolean).join(" · ")
  return x || undefined
}

function kv(rows: Array<[string, string]>): Section {
  return { kind: "kv", rows }
}

/**
 * 自动化/排程族工具按**返回顶层形状**分派渲染（旧的单一「rules||items」逻辑对
 * get/history/validate/run/propose/draft 一律得 0 行 → 空卡）。
 */
export function ruleSections(tool: string, output: string | undefined): Section[] {
  const name = (tool || "").replace(/^mafw_/, "")
  const p = parseOut(output)
  if (p === undefined) return rawSection(output)

  const item = (r: any) => ({
    title: s(r?.name ?? r?.id ?? r?.goalId ?? r?.questionId ?? r?.question ?? r?.summary, "?"),
    subtitle: joinTruthy([r?.trigger?.schedule, r?.action?.type, r?.reason, r?.status]),
    badge: r?.enabled !== undefined ? (r.enabled ? "ON" : "OFF") : (typeof r?.severity === "string" ? r.severity : undefined),
    badgeTone: (r?.enabled === false ? "muted" : r?.severity === "high" ? "err" : r?.severity === "medium" ? "warn" : "accent") as any,
  })

  switch (name) {
    case "list_automation_rules":
    case "list_triage_items": {
      const arr = (name === "list_automation_rules" ? p?.rules : p?.items) ?? (Array.isArray(p) ? p : [])
      return [{ kind: "list", items: (arr || []).map(item) }]
    }
    case "get_automation_history": {
      const arr = p?.history ?? (Array.isArray(p) ? p : [])
      return [{ kind: "list", items: (arr || []).map(item) }]
    }
    case "get_automation_rule": {
      const secs: Section[] = [kv([
        ["id", s(p.id)],
        ["名称", s(p.name)],
        ["启用", p.enabled === undefined ? "-" : p.enabled ? "是" : "否"],
        ["触发", s(p.trigger?.schedule)],
        ["时区", s(p.trigger?.timezone)],
        ["动作", s(p.action?.type)],
        ["Skill", s(p.skill)],
      ])]
      if (Array.isArray(p.nextTriggers) && p.nextTriggers.length) secs.push({ kind: "tags", items: p.nextTriggers.map(String) })
      if (Array.isArray(p.errors) && p.errors.length) secs.push({ kind: "text", text: p.errors.join("; "), tone: "error" })
      return secs
    }
    case "get_triage_item": {
      const secs: Section[] = [kv([
        ["id", s(p.id)],
        ["类型", s(p.kind ?? p.type)],
        ["标题", s(p.title ?? p.summary)],
        ["状态", s(p.status)],
        ["严重度", s(p.severity)],
      ])]
      if (p.detail || p.message) secs.push({ kind: "code", text: trunc(p.detail ?? p.message, 1500) })
      return secs
    }
    case "validate_rule": {
      const secs: Section[] = [kv([["有效", p.valid ? "是" : "否"]])]
      if (Array.isArray(p.errors) && p.errors.length)
        secs.push({ kind: "list", items: p.errors.map((e: any) => ({ title: s(e), badge: "err", badgeTone: "err" as const })) })
      if (Array.isArray(p.nextTriggers) && p.nextTriggers.length) secs.push({ kind: "tags", items: p.nextTriggers.map(String) })
      if (p.note) secs.push({ kind: "text", text: s(p.note), tone: "muted" })
      return secs
    }
    case "draft_automation_rule": {
      const secs: Section[] = [kv([
        ["id", s(p.id)],
        ["有效", p.valid === undefined ? "-" : p.valid ? "是" : "否"],
        ["启用", p.enabled === undefined ? "-" : p.enabled ? "是" : "否"],
      ])]
      if (Array.isArray(p.errors) && p.errors.length) secs.push({ kind: "text", text: p.errors.join("; "), tone: "error" })
      if (p.message) secs.push({ kind: "text", text: s(p.message), tone: "muted" })
      return secs
    }
    case "run_automation":
    case "propose_triage_decision":
      return [kv([
        ["状态", s(p.status)],
        ["triage", s(p.triage_id)],
        ["消息", s(p.message)],
        ["备注", s(p.note)],
      ])]
    default:
      return genericSections(output)
  }
}

/** rule 族工具触发行右侧状态徽标（valid / count / status）。 */
export function ruleBadge(tool: string, output: string | undefined): ToolBadge | undefined {
  const name = (tool || "").replace(/^mafw_/, "")
  const p = parseOut(output)
  if (p === undefined || p === null || typeof p !== "object") return undefined
  switch (name) {
    case "validate_rule":
    case "draft_automation_rule":
      if (typeof p.valid !== "boolean") return undefined
      return { text: p.valid ? "valid" : "invalid", tone: p.valid ? "ok" : "err" }
    case "list_automation_rules": {
      const n = Array.isArray(p.rules) ? p.rules.length : typeof p.count === "number" ? p.count : undefined
      return n === undefined ? undefined : { text: String(n), tone: "muted" }
    }
    case "list_triage_items": {
      const n = Array.isArray(p.items) ? p.items.length : typeof p.count === "number" ? p.count : undefined
      return n === undefined ? undefined : { text: String(n), tone: "muted" }
    }
    case "run_automation":
    case "propose_triage_decision":
      return typeof p.status === "string" && p.status ? { text: p.status, tone: "muted" } : undefined
    default:
      return undefined
  }
}
