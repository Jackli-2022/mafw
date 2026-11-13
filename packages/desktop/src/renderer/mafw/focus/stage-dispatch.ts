// 台的分派：subject + lens → 用哪个舞台渲染。纯函数，方便测试。
import { isLensApplicable, type Focus } from "./focus-model"

export type StageKind = "editor" | "browser" | "terminal" | "plugin" | "changeSet" | "goal" | "world" | "diff"

export type StageAction =
  | { kind: "editor"; root: string; rel: string; intent: "reading" | "editing"; line?: number }
  | { kind: "browser"; url: string }
  | { kind: "none" }

export function stageKindFor(focus: Focus): StageKind {
  if (focus.subject.kind === "diff") return "diff"
  if (!isLensApplicable(focus.subject, focus.lens)) return "world"
  switch (focus.subject.kind) {
    case "file":
      return "editor"
    case "reviewItem":
      return "editor"
    case "web":
      return "browser"
    case "terminal":
      return "terminal"
    case "plugin":
      return "plugin"
    case "changeSet":
      return "changeSet"
    case "goal":
      return "goal"
    case "world":
      return "world"
    default:
      return "world"
  }
}

/** 把焦点翻译成“舞台需要执行的副作用”：打开编辑器 / 导航浏览器 / 什么都不做。 */
export function stageActionFor(focus: Focus): StageAction {
  if (!isLensApplicable(focus.subject, focus.lens)) return { kind: "none" }
  if (focus.subject.kind === "reviewItem") {
    const anchor = focus.subject.anchor
    if (!anchor) return { kind: "none" }
    const root = focus.scope.kind === "goal" ? focus.scope.worktreeDir : ""
    if (!root) return { kind: "none" }
    return { kind: "editor", root, rel: anchor.rel, intent: "reading", line: anchor.line }
  }
  if (focus.subject.kind === "file") {
    return {
      kind: "editor",
      root: focus.subject.root,
      rel: focus.subject.rel,
      intent: focus.lens === "edit" ? "editing" : "reading",
    }
  }
  if (focus.subject.kind === "web") {
    return { kind: "browser", url: focus.subject.url }
  }
  return { kind: "none" }
}
