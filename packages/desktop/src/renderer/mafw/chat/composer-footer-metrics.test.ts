import { test } from "node:test"
import assert from "node:assert/strict"
import { cacheHitPercent, lastTurnTokensPerSecond, tokensPerSecond } from "./composer-footer-metrics"

test("cacheHitPercent counts prompt-cache reads against the whole prompt", () => {
  assert.equal(cacheHitPercent(487_130, 7_517_056), 93.9)
  assert.equal(cacheHitPercent(0, 0), null)
  assert.equal(cacheHitPercent(100, 0), 0)
  assert.equal(cacheHitPercent(0, 100), 100)
})

test("tokensPerSecond ignores empty or instantaneous turns", () => {
  assert.equal(tokensPerSecond(106, 2983), 36)
  assert.equal(tokensPerSecond(0, 2983), null)
  assert.equal(tokensPerSecond(106, 0), null)
  assert.equal(tokensPerSecond(106, 20), null)
})

test("lastTurnTokensPerSecond skips skeleton and unmeasured assistant messages", () => {
  const messages = [
    { role: "user", time: { created: 1, completed: 2 } },
    { role: "assistant", tokens: { output: 50 }, time: { created: 0, completed: 1000 } },
    { role: "assistant", tokens: { output: 120 }, time: { created: 0 } },
  ]
  assert.equal(lastTurnTokensPerSecond(messages), 50)
  assert.equal(lastTurnTokensPerSecond([]), null)
  assert.equal(lastTurnTokensPerSecond(null), null)
})
