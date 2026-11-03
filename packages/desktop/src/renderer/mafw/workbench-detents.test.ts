import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

describe("workbench absolute px detents (spec 2026-11-04, rev3: default 760)", () => {
  test("constants", () => {
    assert.deepEqual(WORKBENCH_DETENTS, [520, 640, 760])
    assert.equal(WORKBENCH_DEFAULT_DETENT, 760)
    assert.equal(CHAT_PX_FLOOR, 320)
    assert.equal(CHAT_PX_CEIL, 760)
    assert.equal(WORKBENCH_MIN_WIDTH, 720)
  })

  test("chatPxForDetent：绝对档 + 护栏（工作台下限 720 / 墙 320-760）", () => {
    assert.equal(chatPxForDetent(760, 1554), 760) // 1600 窗：46 rail + 760 chat + 794 工作台
    assert.equal(chatPxForDetent(760, 1320), 600) // 1366 基线：chat 让位保工作台 720
    assert.equal(chatPxForDetent(760, 1042), 322) // 1088 硬下限：46 rail + 322 chat + 720 工作台
    assert.equal(chatPxForDetent(760, 1394), 674)
    assert.equal(chatPxForDetent(640, 1394), 640)
    assert.equal(chatPxForDetent(520, 1394), 520)
    assert.equal(chatPxForDetent(760, 1280), 560)
    assert.equal(chatPxForDetent(640, 1344), 624)
    assert.equal(chatPxForDetent(640, 1154), 434)
    assert.equal(chatPxForDetent(520, 674), 320)
    assert.equal(chatPxForDetent(520, 2000), 520)
  })

  test("snapDetent：按实际像素距离吸附（无比例语义）", () => {
    assert.equal(snapDetent(430, 1394), 520)
    assert.equal(snapDetent(500, 1394), 520)
    assert.equal(snapDetent(600, 1394), 640)
    assert.equal(snapDetent(700, 1394), 760) // 760 档被钳到 674，距离 700 比 640 近
    assert.equal(snapDetent(720, 1394), 760)
    assert.equal(snapDetent(200, 1394), 520)
    assert.equal(snapDetent(1000, 1394), 760)
    assert.equal(snapDetent(600, 1154), 520)
  })

  test("ratioPercentFromDrag：px → 可用宽百分比（一位小数，仅显示）", () => {
    assert.equal(ratioPercentFromDrag(520, 1394), 37.3)
    assert.equal(ratioPercentFromDrag(760, 1394), 54.5)
    assert.equal(ratioPercentFromDrag(100, 0), 0)
  })

  test("migrateLegacyChatWidth：旧 px → 像素最近档（缺失/非法→760）", () => {
    assert.equal(migrateLegacyChatWidth(417, 1394), 520)
    assert.equal(migrateLegacyChatWidth(558, 1394), 520)
    assert.equal(migrateLegacyChatWidth(697, 1394), 760)
    assert.equal(migrateLegacyChatWidth(750, 1394), 760)
    assert.equal(migrateLegacyChatWidth(null, 1394), 760)
    assert.equal(migrateLegacyChatWidth(Number.NaN, 1394), 760)
    assert.equal(migrateLegacyChatWidth(-5, 1394), 760)
    assert.equal(migrateLegacyChatWidth(400, 0), 760)
  })

  test("normalizeDetent：持久化值归一（旧 420 / 非法回默认 760，存量 640 不丢）", () => {
    assert.equal(normalizeDetent("520"), 520)
    assert.equal(normalizeDetent(640), 640)
    assert.equal(normalizeDetent("760"), 760)
    assert.equal(normalizeDetent("420"), 760)
    assert.equal(normalizeDetent("999"), 760)
    assert.equal(normalizeDetent("abc"), 760)
    assert.equal(normalizeDetent(null), 760)
  })

  test("resize tooltip follows the 760 default detent", () => {
    const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")
    assert.match(shell, /双击回默认档 760/)
    assert.doesNotMatch(shell, /双击回默认档 640/)
  })
})
