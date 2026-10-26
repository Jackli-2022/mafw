import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { defaultDockOpen } from "./workbench-defaults"

describe("workbench defaults", () => {
  test("defaultDockOpen：未存过默认打开；显式 0 尊重为关闭", () => {
    assert.equal(defaultDockOpen(null), true)
    assert.equal(defaultDockOpen("1"), true)
    assert.equal(defaultDockOpen("0"), false)
    assert.equal(defaultDockOpen("bogus"), false)
  })
})
