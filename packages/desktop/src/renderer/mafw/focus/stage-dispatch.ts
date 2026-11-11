// 台的分派：subject + lens → 用哪个舞台渲染。纯函数，方便测试。
import { isLensApplicable, type Focus } from "./focus-model"

export type StageKind = "editor" | "browser" | "terminal" | "plugin" | "changeSet" | "goal" | "world"

export function stageKindFor(focus: Focus): StageKind {
  if (!isLensApplicable(focus.subject, focus.lens)) return "world"
  switch (focus.subject.kind) {
    case "file":
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
