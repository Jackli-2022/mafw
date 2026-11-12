import { test } from "node:test"
import assert from "node:assert/strict"
import {
  closeEpisode,
  createEpisode,
  groupTurnsByEpisode,
  reopenEpisode,
  type ChatEpisode,
} from "./episode-model"

function episode(overrides: Partial<ChatEpisode> = {}): ChatEpisode {
  return {
    id: "ep1",
    sessionID: "s1",
    title: "讨论",
    startMessageId: "u2",
    endMessageId: null,
    status: "open",
    decisionRecordId: null,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  }
}

const turns = [{ id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "u4" }, { id: "u5" }]

test("createEpisode defaults to open and trims the title", () => {
  const created = createEpisode({
    sessionID: "s1",
    title: "  方向讨论  ",
    startMessageId: "u1",
    now: "2026-11-12T01:00:00.000Z",
    id: "ep_x",
  })
  assert.equal(created.status, "open")
  assert.equal(created.title, "方向讨论")
  assert.equal(created.endMessageId, null)
  assert.equal(created.decisionRecordId, null)
  assert.equal(created.createdAt, "2026-11-12T01:00:00.000Z")
  assert.equal(created.id, "ep_x")
})

test("groupTurnsByEpisode keeps unassigned turns and exact boundaries", () => {
  const closed = closeEpisode(episode(), "u3", "dec_1")
  const groups = groupTurnsByEpisode(turns, [closed])
  assert.deepEqual(groups.map((group) => ({
    episode: group.episode?.id ?? null,
    turns: group.turns.map((turn) => turn.id),
  })), [
    { episode: null, turns: ["u1"] },
    { episode: "ep1", turns: ["u2", "u3"] },
    { episode: null, turns: ["u4", "u5"] },
  ])
})

test("closed episode without an end extends to the end", () => {
  const closed = episode({ status: "closed", endMessageId: null })
  const groups = groupTurnsByEpisode(turns, [closed])
  assert.deepEqual(groups.map((group) => group.turns.map((turn) => turn.id)), [
    ["u1"],
    ["u2", "u3", "u4", "u5"],
  ])
})

test("unknown episode start is ignored", () => {
  const groups = groupTurnsByEpisode(turns, [episode({ startMessageId: "missing" })])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.episode, null)
  assert.equal(groups[0]!.turns.length, 5)
})

test("reopenEpisode clears the end and decision link", () => {
  const closed = closeEpisode(episode(), "u3", "dec_1")
  const reopened = reopenEpisode(closed)
  assert.equal(reopened.status, "open")
  assert.equal(reopened.endMessageId, null)
  assert.equal(reopened.endAt, undefined)
  assert.equal(reopened.decisionRecordId, null)
  assert.notEqual(reopened.updatedAt, closed.updatedAt)
})

test("startAt and endAt survive optimistic id reconciliation", () => {
  const timed = [
    { id: "msg_u1", time: { created: 1_000 } },
    { id: "msg_u2", time: { created: 5_000 } },
    { id: "msg_u3", time: { created: 9_000 } },
    { id: "msg_u4", time: { created: 13_000 } },
  ]
  const open = createEpisode({
    sessionID: "s1",
    title: "重载后仍成组",
    startMessageId: "user-optimistic",
    startAt: 5_040,
    id: "ep_time",
  })
  const closed = closeEpisode(open, "user-optimistic-end", "dec_time", 9_060)
  const groups = groupTurnsByEpisode(timed, [closed])
  assert.deepEqual(groups.map((group) => ({
    episode: group.episode?.id ?? null,
    turns: group.turns.map((turn) => turn.id),
  })), [
    { episode: null, turns: ["msg_u1"] },
    { episode: "ep_time", turns: ["msg_u2", "msg_u3"] },
    { episode: null, turns: ["msg_u4"] },
  ])
})
