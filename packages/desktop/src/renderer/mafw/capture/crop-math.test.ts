import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { clampRect, containFit, normalizeDrag, toImageRect } from "./crop-math"

describe("screenshot crop math", () => {
  test("normalizeDrag：任意拖向 → 正向矩形", () => {
    assert.deepEqual(normalizeDrag({ x: 10, y: 20 }, { x: 110, y: 80 }), { x: 10, y: 20, width: 100, height: 60 })
    assert.deepEqual(normalizeDrag({ x: 110, y: 80 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 100, height: 60 })
  })

  test("clampRect：限制在图片显示区", () => {
    const bounds = { x: 100, y: 50, width: 400, height: 300 }
    assert.deepEqual(clampRect({ x: 80, y: 40, width: 100, height: 60 }, bounds), { x: 100, y: 50, width: 80, height: 50 })
    assert.deepEqual(clampRect({ x: 300, y: 200, width: 300, height: 300 }, bounds), { x: 300, y: 200, width: 200, height: 150 })
    assert.deepEqual(clampRect({ x: 600, y: 500, width: 10, height: 10 }, bounds), { x: 500, y: 350, width: 0, height: 0 })
  })

  test("containFit：宽图贴宽、高图贴高、居中", () => {
    assert.deepEqual(containFit({ width: 1920, height: 1080 }, { width: 960, height: 960 }), { x: 0, y: 210, width: 960, height: 540 })
    assert.deepEqual(containFit({ width: 1080, height: 1920 }, { width: 960, height: 960 }), { x: 210, y: 0, width: 540, height: 960 })
    assert.deepEqual(containFit({ width: 0, height: 100 }, { width: 10, height: 10 }), { x: 0, y: 0, width: 0, height: 0 })
  })

  test("toImageRect：显示坐标 → 原图像素", () => {
    const display = { x: 100, y: 50, width: 480, height: 270 }
    const image = { width: 1920, height: 1080 }
    assert.deepEqual(toImageRect({ x: 100, y: 50, width: 240, height: 135 }, display, image), { x: 0, y: 0, width: 960, height: 540 })
    assert.deepEqual(toImageRect({ x: 340, y: 185, width: 240, height: 135 }, display, image), { x: 960, y: 540, width: 960, height: 540 })
  })

  test("toImageRect：太小/退化选区 → null", () => {
    const display = { x: 0, y: 0, width: 960, height: 540 }
    assert.equal(toImageRect({ x: 10, y: 10, width: 1, height: 1 }, display, { width: 1920, height: 1080 }), null)
    assert.equal(toImageRect({ x: 0, y: 0, width: 0, height: 0 }, display, { width: 1920, height: 1080 }), null)
    assert.equal(toImageRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 }, { width: 100, height: 100 }), null)
  })
})
