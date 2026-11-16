import assert from "node:assert/strict"
import { test } from "node:test"
import { searchResults } from "./extract"

test("searchResults parses episode hits and marks legacy episodic results", () => {
  const out = searchResults(JSON.stringify({
    results: [
      { id: "mem_1", type: "semantic", primary_abstraction: "knowledge" },
      { id: "mem_legacy", type: "episodic", primary_abstraction: "old narrative" },
    ],
    episodes: [
      {
        episodeId: "t1ep_a",
        intent: "review embedding",
        actors: ["agent:reviewer", "agent:builder"],
        startTurn: 1,
        endTurn: 3,
        boundarySource: "declared",
      },
    ],
    hint: "episodes are what happened",
  }))
  assert.equal(out.results[1].legacyEpisodic, true)
  assert.equal(out.episodes.length, 1)
  assert.deepEqual(out.episodes[0], {
    episodeId: "t1ep_a",
    title: "review embedding",
    actors: ["agent:reviewer", "agent:builder"],
    turns: 3,
    boundarySource: "declared",
  })
  assert.equal(out.hint, "episodes are what happened")
})
