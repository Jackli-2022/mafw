import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveEpisodeGoalReference } from "./episode-decision"

const focus = { goalId: "goal-focus", revision: 3 }
const content = { goalId: "goal-content", revision: 2 }

test("Tech Lead thread wins over the current workbench focus", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_thread",
    techLeadGoalBySession: { ses_thread: "goal-thread" },
    podGoals: [{ goalId: "goal-thread", activeRevision: 5, revision: 4 }],
    focusGoal: focus,
    contentGoal: content,
  }), { goalId: "goal-thread", revision: 5 })
})

test("thread goal without a loaded revision still links the record", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_thread",
    techLeadGoalBySession: { ses_thread: "goal-thread" },
    podGoals: [],
    focusGoal: focus,
  }), { goalId: "goal-thread", revision: null })
})

test("non-thread sessions fall back to focus, then content scope", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_normal",
    techLeadGoalBySession: {},
    focusGoal: focus,
    contentGoal: content,
  }), focus)
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_normal",
    techLeadGoalBySession: {},
    contentGoal: content,
  }), content)
  assert.equal(resolveEpisodeGoalReference({
    sessionID: "ses_normal",
    techLeadGoalBySession: {},
  }), null)
})
