import { L } from "../labels"
import { item } from "../model"
import type { MenuModel } from "../types"

export interface ProjectMenuTarget {
  id: string
  path: string
  name?: string
}

export function buildProjectMenu(target: ProjectMenuTarget): MenuModel {
  void target
  return {
    surface: "project.row",
    items: [
      item("project.newSession", L.project.newSession),
      item("project.reveal", L.project.reveal),
      item("project.copyPath", L.project.copyPath),
    ],
  }
}
