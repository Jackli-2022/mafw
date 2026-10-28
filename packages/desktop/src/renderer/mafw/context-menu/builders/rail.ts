import { L } from "../labels"
import { item } from "../model"
import type { MenuItem, MenuModel } from "../types"

export interface RailNewMenuTarget {
  worktreeEnabled: boolean
}

export function buildRailNewMenu(target: RailNewMenuTarget): MenuModel {
  const items: MenuItem[] = [item("rail.newSession", L.rail.newSession)]
  if (target.worktreeEnabled) items.push(item("rail.newWorktree", L.rail.newWorktree))
  return { surface: "rail.new", items }
}
