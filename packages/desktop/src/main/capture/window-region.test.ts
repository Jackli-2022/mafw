import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { windowRegionToImageRect } from "./window-region"

const base = {
  content: { x: 100, y: 50 },
  display: { x: 0, y: 0, width: 2560, height: 1440 },
  scale: 1.25,
  image: { width: 3200, height: 1800 },
}

describe("window region → display image rect", () => {
  test("窗口内容坐标 + 屏幕偏移 + 缩放", () => {
    assert.deepEqual(
      windowRegionToImageRect({ ...base, rect: { x: 10, y: 20, width: 200, height: 100 } }),
      { x: 138, y: 88, width: 250, height: 125 },
    )
  })

  test("越界裁剪到图像内", () => {
    const r = windowRegionToImageRect({ ...base, rect: { x: -200, y: -100, width: 500, height: 300 } })
    assert.ok(r)
    assert.equal(r!.x, 0)
    assert.equal(r!.y, 0)
    assert.ok(r!.width > 0 && r!.height > 0)
    const far = windowRegionToImageRect({ ...base, rect: { x: 4000, y: 2000, width: 100, height: 100 } })
    assert.equal(far, null)
  })

  test("退化尺寸 → null", () => {
    assert.equal(windowRegionToImageRect({ ...base, rect: { x: 0, y: 0, width: 0, height: 0 } }), null)
    assert.equal(windowRegionToImageRect({ ...base, rect: { x: 0, y: 0, width: 0.5, height: 0.5 } }), null)
  })
})
