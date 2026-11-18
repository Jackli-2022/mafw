// Session titlebar overflow (2026-11-18): the header keeps identity + one action
// (交给 Lead) and everything else folds into a grouped menu. Pure model so the
// visibility rules stay testable without a DOM.

export type SessionMenuActionId =
  | "details"
  | "timeline"
  | "mark-episode"
  | "parallel"
  | "topics"
  | "lead-status"
  | "return-lead"
  | "back-parent"
  | "close-pane"

export type SessionMenuGroupId = "view" | "session" | "lead" | "nav"

export interface SessionMenuItem {
  id: SessionMenuActionId
  label: string
  kind: "action" | "toggle"
  checked?: boolean
  disabled?: boolean
  shortcut?: string
}

export interface SessionMenuGroup {
  id: SessionMenuGroupId
  label: string
  items: SessionMenuItem[]
}

export interface SessionMenuInput {
  /** 工具/编辑卡默认展开（全局偏好，localStorage['mafw-chat-details']）。 */
  detailsMode: boolean
  /** 标题栏「从这里开始新段落」需要至少一个可见回合。 */
  hasTurns: boolean
  /** Experience `session.worktree` 能力门。 */
  worktreeEnabled: boolean
  isLead: boolean
  topicsOpen: boolean
  leadStatusOpen: boolean
  showReturnLead: boolean
  hasParent: boolean
  canClosePane: boolean
}

export function buildSessionMenu(input: SessionMenuInput): SessionMenuGroup[] {
  const groups: SessionMenuGroup[] = []

  groups.push({
    id: "view",
    label: "视图",
    items: [
      {
        id: "details",
        label: "展开细节",
        kind: "toggle",
        checked: input.detailsMode,
        shortcut: "Ctrl+O",
      },
    ],
  })

  const session: SessionMenuItem[] = [
    { id: "timeline", label: "时间线 / 检查点", kind: "action", shortcut: "/undo" },
    {
      id: "mark-episode",
      label: "从这里开始新段落",
      kind: "action",
      disabled: !input.hasTurns,
    },
  ]
  if (input.worktreeEnabled) {
    session.push({ id: "parallel", label: "并行任务（worktree）", kind: "action" })
  }
  groups.push({ id: "session", label: "会话", items: session })

  if (input.isLead) {
    groups.push({
      id: "lead",
      label: "Lead",
      items: [
        { id: "topics", label: "话题", kind: "toggle", checked: input.topicsOpen },
        { id: "lead-status", label: "Goal 状态", kind: "toggle", checked: input.leadStatusOpen },
      ],
    })
  }

  const nav: SessionMenuItem[] = []
  if (input.showReturnLead) nav.push({ id: "return-lead", label: "返回项目 Lead", kind: "action" })
  if (input.hasParent) nav.push({ id: "back-parent", label: "返回父会话", kind: "action" })
  if (input.canClosePane) nav.push({ id: "close-pane", label: "关闭分屏", kind: "action" })
  if (nav.length > 0) groups.push({ id: "nav", label: "导航", items: nav })

  return groups
}

export function sessionMenuActionCount(groups: readonly SessionMenuGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0)
}
