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

export function rawSection(output: string | undefined): Section[] {
  return output ? [{ kind: "code", text: output }] : []
}

const verdictTone = (v: any): ListItem["badgeTone"] => {
  const x = String(v ?? "").toUpperCase()
  if (x === "COMPLETED" || x === "PASS") return "ok"
  if (x === "FAILED" || x === "CANCELLED" || x === "FAIL") return "err"
  return "accent"
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

  // ── 记忆检索族 ──────────────────────────────────────────────
  mafw_get_memory: {
    icon: "brain", title: "记忆全文",
    subtitle: (i) => trunc(i?.id, 24),
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      const m = p.memory ?? p
      const secs: Section[] = [{
        kind: "kv",
        rows: [
          ["id", s(m.id ?? i?.id)],
          ["类型", s(m.type)],
          ["能量", s(m.energy)],
          ["pinned", m.pinned ? "是" : "-"],
          ["sticky", s(m.sticky_until)],
        ],
      }]
      if (Array.isArray(m.cue_anchors) && m.cue_anchors.length)
        secs.push({ kind: "tags", items: m.cue_anchors.map(String) })
      if (m.memory_value)
        secs.push({ kind: "code", text: trunc(m.memory_value, 2000), language: "markdown" })
      if (m.superseded_by)
        secs.push({ kind: "text", text: `已被取代 → ${m.superseded_by}`, tone: "warn" })
      return secs
    },
  },
  mafw_get_axioms: {
    icon: "glasses", title: "L5 公理",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.axioms ?? p?.heuristics
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((a: any) => ({
          title: s(a.pattern ?? a.primary_abstraction ?? a.content),
          badge: a.energy != null ? `E:${Number(a.energy).toFixed(1)}` : undefined,
          badgeTone: "accent" as const,
        })),
      }]
    },
  },

  // ── Goal 编排族 ─────────────────────────────────────────────
  mafw_create_goal: {
    icon: "checklist", title: "创建 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["标题", s(i?.title)],
        ["优先级", s(i?.priority, "medium")],
        ["最大循环", s(i?.maxLoops, 5)],
        ["预算", i?.budget ? `${i.budget.maxTurns ?? "-"} 轮 / $${i.budget.maxCostUsd ?? "-"}` : "-"],
      ],
    }],
  },
  mafw_set_goal: {
    icon: "checklist", title: "设置 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["标题", s(i?.title)],
        ["优先级", s(i?.priority, "medium")],
        ["最大循环", s(i?.maxLoops, 5)],
        ["预算", i?.budget ? `${i.budget.maxTurns ?? "-"} 轮 / $${i.budget.maxCostUsd ?? "-"}` : "-"],
      ],
    }],
  },
  mafw_get_goal_status: {
    icon: "magnifying-glass", title: "Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["Goal", s(p.goalId ?? i?.goalId)],
          ["阶段", s(p.phase)],
          ["判定", s(p.verdict)],
          ["循环", s(p.loopNum ?? p.loop)],
        ],
      }]
    },
  },
  mafw_list_goals: {
    icon: "bullet-list", title: "Goal 列表",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.goals
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((g: any) => ({
          title: s(g.title ?? g.goalId ?? g.id),
          subtitle: g.title ? s(g.goalId ?? g.id, "") : undefined,
          badge: s(g.phase ?? g.verdict, ""),
          badgeTone: verdictTone(g.verdict ?? g.phase),
        })),
      }]
    },
  },
  mafw_cancel_goal: {
    icon: "warning", title: "取消 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i, o) => {
      const secs: Section[] = [{ kind: "kv", rows: [["Goal", s(i?.goalId)]] }]
      if (o) secs.push({ kind: "text", text: trunc(o, 200), tone: "muted" })
      return secs
    },
  },
  mafw_get_evidence: {
    icon: "folder", title: "Goal 证据",
    subtitle: (i) => i?.goalId,
    extract: (_i, o) => (o ? [{ kind: "code", text: trunc(o, 4000), language: "markdown" }] : []),
  },
  mafw_update_state: {
    icon: "edit", title: "更新 Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (i) => {
      const secs: Section[] = [{ kind: "kv", rows: [["Goal", s(i?.goalId)]] }]
      if (i?.patch) secs.push({ kind: "code", text: JSON.stringify(i.patch, null, 2), language: "json" })
      return secs
    },
  },
  mafw_load_state: {
    icon: "folder", title: "读取 Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (_i, o) => {
      const p = parseOut(o)
      if (p === undefined) return rawSection(o)
      return [{ kind: "code", text: JSON.stringify(p, null, 2), language: "json" }]
    },
  },
  mafw_answer_question: {
    icon: "help", title: "回答 Goal 提问",
    subtitle: (i) => i?.questionId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["问题", s(i?.questionId)],
        ["回答", s(i?.answer)],
      ],
    }],
  },
  mafw_list_pending_questions: {
    icon: "bullet-list", title: "待决问题",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.questions
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((q: any) => ({
          title: s(q.question ?? q.text ?? q.id),
          badge: s(q.goalId, ""),
          badgeTone: "accent" as const,
        })),
      }]
    },
  },

  // ── 交互/反馈族 ─────────────────────────────────────────────
  mafw_ask_user: {
    icon: "help", title: "向用户提问",
    subtitle: (i) => trunc(i?.question, 50),
    extract: (i) => {
      const secs: Section[] = [{ kind: "text", text: s(i?.question) }]
      if (Array.isArray(i?.options) && i.options.length)
        secs.push({ kind: "tags", items: i.options.map(String) })
      return secs
    },
  },
  mafw_record_feedback: {
    icon: "comment", title: "记录反馈",
    subtitle: (i) => i?.type,
    extract: (i) => {
      const mark = i?.type === "thumbs_up" ? "👍" : i?.type === "thumbs_down" ? "👎" : "✏️"
      return [{
        kind: "kv",
        rows: [
          ["类型", `${mark} ${s(i?.type)}`],
          ["目标", s(i?.targetId)],
          ["Goal", s(i?.goalId)],
          ["循环", s(i?.loopNum)],
          ["备注", s(i?.comment)],
        ],
      }]
    },
  },
  mafw_get_model_route: {
    icon: "models", title: "模型路由",
    subtitle: (i) => i?.agentType,
    extract: (i, o) => {
      const p = parseOut(o)
      const route = p && typeof p === "object" ? s(p.model ?? p.route) : s(o)
      return [{
        kind: "kv",
        rows: [
          ["Agent", s(i?.agentType)],
          ["剩余预算", s(i?.remainingBudget)],
          ["总预算", s(i?.totalBudget)],
          ["路由", route],
        ],
      }]
    },
  },

  // ── 桌面控制族 ──────────────────────────────────────────────
  mafw_desktop_screenshot: {
    icon: "magnifying-glass", title: "桌面截图",
    subtitle: (i) => i?.selector,
    extract: (i, o) => {
      const p = parseOut(o)
      if (p && typeof p === "object" && (p.path || p.file))
        return [{ kind: "kv", rows: [["区域", s(i?.selector, "全窗口")], ["文件", s(p.path ?? p.file)]] }]
      return rawSection(o)
    },
  },
  mafw_desktop_navigate: {
    icon: "menu", title: "桌面导航",
    subtitle: (i) => i?.tab,
    extract: (i) => [{ kind: "kv", rows: [["目标 Tab", s(i?.tab)]] }],
  },
  mafw_desktop_get_ui_state: {
    icon: "bullet-list", title: "桌面 UI 状态",
    extract: (_i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["活跃 Tab", s(p.activeTab)],
          ["元素数", s(Array.isArray(p.elements) ? p.elements.length : p.elementCount)],
          ["窗口", p.window ? `${p.window.width}×${p.window.height}` : s(p.dimensions)],
        ],
      }]
    },
  },
  mafw_desktop_click: {
    icon: "enter", title: "桌面点击",
    subtitle: (i) => i?.selector,
    extract: (i, o) => {
      const p = parseOut(o)
      const hit = p && typeof p === "object" ? `${s(p.tag, "")} ${s(p.text, "")}`.trim() : ""
      return [{ kind: "kv", rows: [["Selector", s(i?.selector)], ["命中", hit || "-"]] }]
    },
  },
  mafw_desktop_type: {
    icon: "edit", title: "桌面输入",
    subtitle: (i) => trunc(i?.text, 40),
    extract: (i) => [{ kind: "kv", rows: [["Selector", s(i?.selector)], ["文本", trunc(i?.text, 80)]] }],
  },
  mafw_desktop_scroll: {
    icon: "menu", title: "桌面滚动",
    subtitle: (i) => `${s(i?.direction, "")} ${s(i?.amount, "")}`.trim(),
    extract: (i) => [{ kind: "kv", rows: [["方向", s(i?.direction)], ["像素", s(i?.amount, 200)]] }],
  },
  mafw_restart_agent: {
    icon: "rotate-ccw", title: "重启 Agent",
    extract: (_i, o) =>
      o ? [{ kind: "text", text: trunc(o, 200), tone: /fail|error|503/i.test(o) ? "error" as const : "muted" as const }] : [],
  },

  // ── 媒体族 ─────────────────────────────────────────────────
  mafw_media_upload: {
    icon: "mcp", title: "媒体上传",
    subtitle: (i) => s(i?.mediaPath, "").split(/[\\/]/).pop() || undefined,
    extract: (i, o) => {
      const p = parseOut(o)
      return [{
        kind: "kv",
        rows: [
          ["文件", s(s(i?.mediaPath, "").split(/[\\/]/).pop())],
          ["taskID", s(p?.taskID ?? p?.taskId)],
          ["首问", trunc(i?.question, 60)],
          ["回答", trunc(p?.answer ?? p?.response, 200)],
        ],
      }]
    },
  },
  mafw_media_ask: {
    icon: "magnifying-glass", title: "媒体追问",
    subtitle: (i) => trunc(i?.question, 50),
    extract: (i, o) => {
      const p = parseOut(o)
      const secs: Section[] = [{
        kind: "kv",
        rows: [["taskID", s(i?.taskID)], ["问题", trunc(i?.question, 120)]],
      }]
      const ans = p?.answer ?? p?.output ?? (p === undefined && o ? o : undefined)
      if (ans) secs.push({ kind: "text", text: trunc(ans, 500) })
      if (p?.newTaskID) secs.push({ kind: "tags", items: [`新 taskID: ${p.newTaskID}`] })
      return secs
    },
  },
  mafw_media_speak: {
    icon: "comment", title: "语音回复",
    subtitle: (i) => trunc(i?.text, 50),
    extract: (i) => [
      { kind: "kv", rows: [["音色", s(i?.voice)], ["风格", s(i?.style)]] },
      { kind: "text", text: trunc(i?.text, 200) },
    ],
  },
}
