import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodGoal } from "@mafw/sdk"
import {
  buildDiscussionGroups,
  buildGoalGroups,
  filterDiscussionGroups,
  filterGoalGroups,
} from "./changes-tree"
import type { SessionTurnChange } from "./session-turns"

const goal = (id: string, title: string, revision = 2): PodGoal => ({
  podId: "p1",
  goalId: id,
  title,
  status: "active",
  activeRevision: revision,
  revision,
} as PodGoal)

const turn = (id: string, title: string, file: string): SessionTurnChange => ({
  id,
  title,
  timeLabel: "14:32",
  createdAt: 1,
  files: [{ file, additions: 2, deletions: 1 }],
  additions: 2,
  deletions: 1,
})

test("Goal groups put the current Goal first and list revisions newest first", () => {
  const groups = buildGoalGroups({
    goals: [goal("g1", "会话恢复", 1), goal("g2", "修复登录", 3)],
    activeGoalId: "g2",
    reviewCountForGoal: (id) => (id === "g2" ? 2 : 0),
  })
  assert.deepEqual(groups.map((group) => group.id), ["g2", "g1"])
  assert.equal(groups[0]?.current, true)
  assert.equal(groups[0]?.pendingReview, 2)
  assert.deepEqual(groups[0]?.revisions.map((revision) => revision.revision), [3, 2, 1])
  assert.deepEqual(groups[0]?.revisions.map((revision) => revision.current), [true, false, false])
})

test("discussion groups only expose turns for the current discussion", () => {
  const groups = buildDiscussionGroups({
    sessions: [{ id: "s1", title: "修复登录" }, { id: "s2", title: "会话恢复" }],
    activeSessionID: "s1",
    turns: [turn("m1", "修复登录失败", "src/a.ts")],
    sessionDiffs: [{ file: "src/a.ts", additions: 2, deletions: 1 }],
  })
  assert.equal(groups[0]?.current, true)
  assert.equal(groups[0]?.turns.length, 1)
  assert.equal(groups[0]?.fileCount, 1)
  assert.equal(groups[0]?.additions, 2)
  assert.equal(groups[1]?.turns.length, 0)
  assert.equal(groups[1]?.fileCount, 0)
})

test("Goal filters honor the review tab", () => {
  const groups = buildGoalGroups({
    goals: [goal("g1", "修复登录"), goal("g2", "会话恢复")],
    activeGoalId: null,
    reviewCountForGoal: (id) => (id === "g1" ? 1 : 0),
  })
  assert.deepEqual(filterGoalGroups(groups, "", "all").map((group) => group.id), ["g1", "g2"])
  assert.deepEqual(filterGoalGroups(groups, "", "review").map((group) => group.id), ["g1"])
  assert.deepEqual(filterGoalGroups(groups, "会话", "all").map((group) => group.id), ["g2"])
})

test("discussion filters match turn titles and file paths", () => {
  const groups = buildDiscussionGroups({
    sessions: [{ id: "s1", title: "修复登录" }, { id: "s2", title: "会话恢复" }],
    activeSessionID: "s1",
    turns: [turn("m1", "补登录测试", "src/auth/login.ts")],
    sessionDiffs: [{ file: "src/auth/login.ts" }],
  })
  assert.deepEqual(filterDiscussionGroups(groups, "登录测试", "all").map((group) => group.id), ["s1"])
  assert.deepEqual(filterDiscussionGroups(groups, "src/auth", "all").map((group) => group.id), ["s1"])
  assert.deepEqual(filterDiscussionGroups(groups, "", "changes").map((group) => group.id), ["s1"])
  assert.deepEqual(filterDiscussionGroups(groups, "", "review").map((group) => group.id), ["s1"])
})
