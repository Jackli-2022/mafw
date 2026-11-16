import { expect, test } from "bun:test"
import { buildRailLeadMenu, buildRailNewMenu } from "./rail"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

test("worktree item is hidden when unsupported", () => {
  const withWorktree = buildRailNewMenu({ worktreeEnabled: true })
  expect(ids(withWorktree)).toEqual(["rail.newSession", "rail.newWorktree"])
  expect(validateMenu(withWorktree)).toEqual([])

  const withoutWorktree = buildRailNewMenu({ worktreeEnabled: false })
  expect(ids(withoutWorktree)).toEqual(["rail.newSession"])
  expect(validateMenu(withoutWorktree)).toEqual([])
})

test("Lead context menu keeps the team view reachable", () => {
  const menu = buildRailLeadMenu()
  expect(ids(menu)).toEqual(["rail.viewTeam"])
  expect(validateMenu(menu)).toEqual([])
})
