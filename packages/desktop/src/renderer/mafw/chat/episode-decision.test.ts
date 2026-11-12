import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveEpisodeGoalReference } from "./episode-decision"

const focus = { goalId: "goal-focus", revision: 3 }
const content = { goalId: "goal-content", revision: 2 }

test("Pod session identity wins over the current workbench focus", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_thread",
    techLeadGoalBySession: {},
    sessionGoal: { goalId: "goal-thread", revision: 5 },
    podLoaded: true,
    podGoals: [{ goalId: "goal-thread", activeRevision: 5 }],
    focusGoal: focus,
    contentGoal: content,
  }), { goalId: "goal-thread", revision: 5 })
})

test("thread goal without a loaded revision still links the record", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_thread",
    techLeadGoalBySession: { ses_thread: "goal-thread" },
    podLoaded: false,
    podGoals: [],
    focusGoal: focus,
  }), { goalId: "goal-thread", revision: null })
})

test("a stale mapping is ignored once the Pod is loaded without that goal", () => {
  assert.deepEqual(resolveEpisodeGoalReference({
    sessionID: "ses_thread",
    techLeadGoalBySession: { ses_thread: "goal-deleted" },
    podLoaded: true,
    podGoals: [{ goalId: "goal-thread" }],
    focusGoal: focus,
    contentGoal: content,
  }), focus)
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
