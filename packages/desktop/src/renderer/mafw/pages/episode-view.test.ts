import assert from "node:assert/strict"
import { test } from "node:test"
import { episodeBoundaryLabel, formatEpisodeSummary } from "./episode-view"

test("episode summary names date, actors, intent, turns and boundary source", () => {
  const line = formatEpisodeSummary({
    episodeId: "t1ep_a",
    startedAt: Date.UTC(2026, 10, 16),
    actors: ["agent:reviewer", "agent:builder"],
    intent: "review embedding",
    startTurn: 1,
    endTurn: 4,
    boundarySource: "declared",
  })
  assert.match(line, /2026-11-16/)
  assert.match(line, /reviewer, builder/)
  assert.match(line, /review embedding/)
  assert.match(line, /4 turns/)
  assert.match(line, /declared/)
})

test("episode summary tolerates missing intent and actors", () => {
  const line = formatEpisodeSummary({
    episodeId: "t1ep_b",
    startedAt: null,
    actors: [],
    startTurn: 2,
    endTurn: 2,
    boundarySource: "inferred",
  })
  assert.match(line, /unknown/)
  assert.match(line, /1 turn/)
  assert.doesNotMatch(line, /undefined/)
})

test("episode boundary labels distinguish start and close", () => {
  assert.equal(episodeBoundaryLabel("session_start"), "start")
  assert.equal(episodeBoundaryLabel("declared"), "declared")
  assert.equal(episodeBoundaryLabel("session_end"), "idle-close")
})
