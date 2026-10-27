// checkpoint-rev 单测：SSE session.checkpoint → bump → 订阅方看到递增。
import { expect, test } from "bun:test"
import { checkpointRev, bumpCheckpointRev } from "./checkpoint-rev"

test("bumpCheckpointRev increments the signal", () => {
  const before = checkpointRev()
  bumpCheckpointRev()
  expect(checkpointRev()).toBe(before + 1)
  bumpCheckpointRev()
  expect(checkpointRev()).toBe(before + 2)
})
