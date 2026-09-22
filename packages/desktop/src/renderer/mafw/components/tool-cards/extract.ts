export type Section =
  | { kind: "kv"; rows: Array<[string, string]> }
  | { kind: "tags"; items: string[] }
  | { kind: "text"; text: string; tone?: "muted" | "warn" | "error" }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; items: ListItem[] }

export interface ListItem {
  title: string
  subtitle?: string
  badge?: string
  badgeTone?: "ok" | "warn" | "err" | "muted" | "accent"
}

export interface ToolCardSpec {
  icon: string
  title: string
  subtitle?: (input: any) => string | undefined
  defaultOpen?: boolean
  extract: (input: any, output: string | undefined) => Section[]
}

export const s = (v: any, fb: any = "-"): string =>
  v === undefined || v === null || v === "" ? String(fb) : String(v)

export const trunc = (v: any, n: number): string => {
  const x = s(v, "")
  return x.length > n ? x.slice(0, n) + "…" : x
}

export function parseOut(output: string | undefined): any {
  if (!output) return undefined
  try { return JSON.parse(output) } catch { return undefined }
}

function rawSection(output: string | undefined): Section[] {
  return output ? [{ kind: "code", text: output }] : []
}

export const TOOL_SPECS: Record<string, ToolCardSpec> = {
  // ── 记忆写入族 ──────────────────────────────────────────────
  mafw_supersede_memory: {
    icon: "archive", title: "记忆取代",
    subtitle: (i) => (Array.isArray(i?.ids) ? `${i.ids.length} 条` : undefined),
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["被取代 id", Array.isArray(i?.ids) ? i.ids.join(", ") : s(i?.ids)],
        ["原因", s(i?.reason)],
      ],
    }],
  },
  mafw_pin_memory: {
    icon: "check", title: "记忆 Pin / 便签",
    subtitle: (i) => i?.id,
    extract: (i) => {
      const secs: Section[] = [{
        kind: "kv",
        rows: [
          ["id", s(i?.id)],
          ["pinned", i?.pinned === undefined ? "-" : i.pinned ? "是" : "否"],
        ],
      }]
      const tags: string[] = []
      if (i?.sticky === true) tags.push(`sticky ${i?.stickyDays ?? 7} 天`)
      if (i?.sticky === false) tags.push("下架便签")
      if (tags.length) secs.push({ kind: "tags", items: tags })
      return secs
    },
  },
  mafw_merge_memory: {
    icon: "branch", title: "跨 worktree 记忆融合",
    subtitle: (i) => i?.sourceWorktree,
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["来源", s(i?.sourceWorktree)],
          ["策略", s(i?.resolveStrategy, "manual")],
          ["提取", s(p.extracted ?? p.merged)],
          ["冲突", s(p.conflicts ?? p.conflicting)],
        ],
      }]
    },
  },
  mafw_resolve_merge: {
    icon: "branch", title: "解决融合冲突",
    subtitle: (i) => i?.conflictingId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["冲突 id", s(i?.conflictingId)],
        ["新摘要", s(i?.newAbstraction)],
        ["动作", s(i?.action)],
      ],
    }],
  },
  mafw_commit_heuristic: {
    icon: "archive", title: "提交 L5 启发式",
    subtitle: (i) => trunc(i?.pattern, 50),
    extract: (i) => {
      const secs: Section[] = [{ kind: "text", text: s(i?.pattern) }]
      if (Array.isArray(i?.triggerContext) && i.triggerContext.length)
        secs.push({ kind: "tags", items: i.triggerContext.map(String) })
      return secs
    },
  },
}
