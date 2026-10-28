import { L } from "../labels"
import { item, sep, submenu } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface ExecutionRowMenuTarget {
  sessionID?: string
  taskID?: string
  kind: "subagent" | "background" | "trajectory"
  canCancel: boolean
}

export function buildExecutionRowMenu(target: ExecutionRowMenuTarget): MenuModel {
  const items: MenuItem[] = []
  if (target.sessionID) items.push(item("panel.openSession", L.panel.openSession))
  items.push(item("panel.copyId", L.panel.copyId))

  if (target.kind !== "trajectory" && target.canCancel) {
    items.push(sep(), item("panel.cancel", L.panel.cancel, { danger: true }))
  }

  return { surface: "panel.execution", items }
}

export interface ReviewRowMenuTarget {
  rel: string
}

export function buildReviewRowMenu(target: ReviewRowMenuTarget): MenuModel {
  void target
  return {
    surface: "panel.review",
    items: [
      item("review.open", L.review.open),
      item("review.reveal", L.review.reveal),
      submenu("review.copy", L.review.copy, [
        item("review.copy.rel", L.filePath.copyRel),
        item("review.copy.abs", L.filePath.copyAbs),
        item("review.copy.name", L.filePath.copyName),
      ]),
    ],
  }
}
