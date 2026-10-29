export type MenuSurface =
  | "rail.new"
  | "session.row"
  | "session.tab"
  | "project.row"
  | "message"
  | "code-block"
  | "file.path"
  | "file.tree"
  | "editor.tab"
  | "terminal"
  | "browser"
  | "browser.page"
  | "panel.execution"
  | "panel.review"
  | "goal.card"
  | "goal.cell"
  | "memory.card"
  | "notes.card"
  | "approval.question"
  | "approval.permission"
  | "triage.card"
  | "automation.card"
  | "edit.text"

export type MenuItem =
  | {
      type: "item"
      id: string
      label: string
      icon?: string
      shortcut?: string
      disabled?: boolean
      disabledReason?: string
      danger?: boolean
      confirms?: boolean
    }
  | { type: "separator" }
  | { type: "submenu"; id: string; label: string; icon?: string; items: MenuItem[] }
  | { type: "group"; id: string; label: string; items: MenuItem[] }
  | { type: "checkbox"; id: string; label: string; checked: boolean; disabled?: boolean }
  | { type: "radio"; id: string; label: string; checked: boolean; disabled?: boolean }

export type MenuModel = {
  surface: MenuSurface
  items: MenuItem[]
}

export type MenuOpenSource = "contextmenu" | "ellipsis" | "keyboard"
