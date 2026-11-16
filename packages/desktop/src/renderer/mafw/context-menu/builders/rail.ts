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

/** Lead is the primary click target; the team view stays available on right-click. */
export function buildRailLeadMenu(): MenuModel {
  return { surface: "rail.lead", items: [item("rail.viewTeam", L.rail.viewTeam)] }
}
