import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  CHAT_COMFORT_MIN,
  CHAT_PX_CEIL,
  CHAT_PX_FLOOR,
  WORKBENCH_DEFAULT_DETENT,
  WORKBENCH_DETENTS,
  WORKBENCH_MIN_WIDTH,
  WORKBENCH_SPLIT_MIN_AVAILABLE,
  chatPxForDetent,
  migrateLegacyChatWidth,
  normalizeDetent,
  ratioPercentFromDrag,
  snapDetent,
  workbenchZoneFor,
} from "./workbench-detents"

describe("workbench absolute px detents (A: split / narrow switch)", () => {
  test("constants", () => {
    assert.deepEqual(WORKBENCH_DETENTS, [520, 640, 760])
    assert.equal(WORKBENCH_DEFAULT_DETENT, 760)
    assert.equal(CHAT_PX_FLOOR, 320)
    assert.equal(CHAT_PX_CEIL, 760)
    assert.equal(CHAT_COMFORT_MIN, 520)
    assert.equal(WORKBENCH_MIN_WIDTH, 720)
    assert.equal(WORKBENCH_SPLIT_MIN_AVAILABLE, 1240)
  })

  test("workbenchZoneFor: 1240 is the split boundary", () => {
    assert.equal(workbenchZoneFor(1554), "split")
    assert.equal(workbenchZoneFor(1240), "split")
    assert.equal(workbenchZoneFor(1239), "narrow")
    assert.equal(workbenchZoneFor(1042), "narrow")
    assert.equal(workbenchZoneFor(854), "narrow")
  })

  test("chatPxForDetent split: keep >=520 and reserve 720 for the workbench", () => {
    assert.equal(chatPxForDetent(760, 1554), 760)
    assert.equal(chatPxForDetent(760, 1480), 760)
    assert.equal(chatPxForDetent(760, 1394), 674)
    assert.equal(chatPxForDetent(760, 1320), 600)
    assert.equal(chatPxForDetent(760, 1240), 520)
    assert.equal(chatPxForDetent(640, 1240), 520)
    assert.equal(chatPxForDetent(520, 1300), 520)
  })

  test("chatPxForDetent narrow: 760 default is preserved, no workbench reserve", () => {
    assert.equal(chatPxForDetent(760, 1239), 760)
    assert.equal(chatPxForDetent(760, 1042), 760)
    assert.equal(chatPxForDetent(760, 854), 760)
    assert.equal(chatPxForDetent(760, 654), 654)
    assert.equal(chatPxForDetent(640, 654), 640)
    assert.equal(chatPxForDetent(520, 654), 520)
    assert.equal(chatPxForDetent(760, 400), 400)
    assert.equal(chatPxForDetent(760, 300), 320)
  })

  test("snapDetent: compare clamped px, not ratio labels", () => {
    assert.equal(snapDetent(430, 1394), 520)
    assert.equal(snapDetent(500, 1394), 520)
    assert.equal(snapDetent(600, 1394), 640)
    assert.equal(snapDetent(700, 1394), 760)
    assert.equal(snapDetent(720, 1394), 760)
    assert.equal(snapDetent(200, 1394), 520)
    assert.equal(snapDetent(1000, 1394), 760)
    assert.equal(snapDetent(600, 1042), 640)
    assert.equal(snapDetent(430, 1042), 520)
    assert.equal(snapDetent(800, 1042), 760)
  })

  test("ratioPercentFromDrag: px to percentage is display-only", () => {
    assert.equal(ratioPercentFromDrag(520, 1394), 37.3)
    assert.equal(ratioPercentFromDrag(760, 1394), 54.5)
    assert.equal(ratioPercentFromDrag(100, 0), 0)
  })

  test("migrateLegacyChatWidth: old px to nearest clamped detent", () => {
    assert.equal(migrateLegacyChatWidth(417, 1394), 520)
    assert.equal(migrateLegacyChatWidth(558, 1394), 520)
    assert.equal(migrateLegacyChatWidth(697, 1394), 760)
    assert.equal(migrateLegacyChatWidth(750, 1394), 760)
    assert.equal(migrateLegacyChatWidth(700, 1042), 640)
    assert.equal(migrateLegacyChatWidth(null, 1394), 760)
    assert.equal(migrateLegacyChatWidth(Number.NaN, 1394), 760)
    assert.equal(migrateLegacyChatWidth(-5, 1394), 760)
    assert.equal(migrateLegacyChatWidth(400, 0), 760)
  })

  test("normalizeDetent: persisted 520/640/760 only", () => {
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
