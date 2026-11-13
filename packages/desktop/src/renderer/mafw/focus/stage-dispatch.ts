// 台的分派：subject → 用哪个舞台渲染。纯函数，方便测试。
import type { Focus } from "./focus-model"

export type StageKind = "editor" | "browser" | "terminal" | "plugin" | "goal" | "world" | "diff"

export type StageAction =
  | { kind: "editor"; root: string; rel: string; line?: number }
  | { kind: "browser"; url: string }
  | { kind: "none" }

export function stageKindFor(focus: Focus): StageKind {
  if (focus.subject.kind === "diff") return "diff"
  switch (focus.subject.kind) {
    case "file":
      return "editor"
    case "web":
      return "browser"
    case "terminal":
      return "terminal"
    case "plugin":
      return "plugin"
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
  if (focus.subject.kind === "file") {
    return {
      kind: "editor",
      root: focus.subject.root,
      rel: focus.subject.rel,
    }
  }
  if (focus.subject.kind === "web") {
    return { kind: "browser", url: focus.subject.url }
  }
  return { kind: "none" }
}
