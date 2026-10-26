import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { detentFromLegacy, workbenchColumns } from "./workbench-layout"

describe("workbench layout pure functions", () => {
  test("workbenchColumns：split 三列 / 关闭两列", () => {
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: true }), "0px 520px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 180, chatPx: 640, split: true }), "180px 640px minmax(0, 1fr)")
    assert.equal(workbenchColumns({ leftPx: 0, chatPx: 520, split: false }), "0px minmax(0, 1fr) 0px")
  })

  test("detentFromLegacy：旧 chat 宽度 px → 绝对档位（缺失/非法 → 520）", () => {
    assert.equal(detentFromLegacy("417", 1394), 420)
    assert.equal(detentFromLegacy("558", 1394), 520)
    assert.equal(detentFromLegacy("697", 1394), 640)
    assert.equal(detentFromLegacy(null, 1394), 520)
    assert.equal(detentFromLegacy("abc", 1394), 520)
  })
})
