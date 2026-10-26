import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  CHAT_PX_CEIL,
  CHAT_PX_FLOOR,
  WORKBENCH_DEFAULT_DETENT,
  WORKBENCH_DETENTS,
  WORKBENCH_MIN_WIDTH,
  chatPxForDetent,
  migrateLegacyChatWidth,
  normalizeDetent,
  ratioPercentFromDrag,
  snapDetent,
} from "./workbench-detents"

describe("workbench absolute px detents (spec 2026-10-26, res-2026-10-26-detent)", () => {
  test("constants", () => {
    assert.deepEqual(WORKBENCH_DETENTS, [420, 520, 640])
    assert.equal(WORKBENCH_DEFAULT_DETENT, 520)
    assert.equal(CHAT_PX_FLOOR, 320)
    assert.equal(CHAT_PX_CEIL, 760)
    assert.equal(WORKBENCH_MIN_WIDTH, 520)
  })

  test("chatPxForDetent：绝对档 + 护栏（工作台下限 520 / 墙 320-760）", () => {
    assert.equal(chatPxForDetent(420, 1394), 420)
    assert.equal(chatPxForDetent(520, 1394), 520)
    assert.equal(chatPxForDetent(640, 1394), 640)
    assert.equal(chatPxForDetent(640, 1154), 634) // available − 520
    assert.equal(chatPxForDetent(420, 674), 320) // 窄窗退化（<1200 走 overlay）
    assert.equal(chatPxForDetent(420, 2000), 420) // 上限墙不误伤小档
  })

  test("snapDetent：按实际像素距离吸附（无比例语义）", () => {
    assert.equal(snapDetent(430, 1394), 420)
    assert.equal(snapDetent(500, 1394), 520)
    assert.equal(snapDetent(600, 1394), 640)
    assert.equal(snapDetent(200, 1394), 420)
    assert.equal(snapDetent(1000, 1394), 640)
    // 护栏生效时按钳制后的像素比较：1154 下 640 档实际 = 634
    assert.equal(snapDetent(600, 1154), 640)
  })

  test("ratioPercentFromDrag：px → 可用宽百分比（一位小数，仅显示）", () => {
    assert.equal(ratioPercentFromDrag(520, 1394), 37.3)
    assert.equal(ratioPercentFromDrag(420, 1394), 30.1)
    assert.equal(ratioPercentFromDrag(100, 0), 0)
  })

  test("migrateLegacyChatWidth：旧 px → 像素最近档（缺失/非法→520）", () => {
    assert.equal(migrateLegacyChatWidth(417, 1394), 420)
    assert.equal(migrateLegacyChatWidth(558, 1394), 520)
    assert.equal(migrateLegacyChatWidth(697, 1394), 640)
    assert.equal(migrateLegacyChatWidth(null, 1394), 520)
    assert.equal(migrateLegacyChatWidth(Number.NaN, 1394), 520)
    assert.equal(migrateLegacyChatWidth(-5, 1394), 520)
    assert.equal(migrateLegacyChatWidth(400, 0), 520)
  })

  test("normalizeDetent：持久化值归一（非法回默认）", () => {
    assert.equal(normalizeDetent("420"), 420)
    assert.equal(normalizeDetent(640), 640)
    assert.equal(normalizeDetent("520"), 520)
    assert.equal(normalizeDetent("999"), 520)
    assert.equal(normalizeDetent("abc"), 520)
    assert.equal(normalizeDetent(null), 520)
  })
})
