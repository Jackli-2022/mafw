import { expect, test } from "bun:test"
import { clampMenuPoint } from "./clamp"

test("clamps a menu that would overflow the viewport", () => {
  expect(clampMenuPoint({ x: 990, y: 590 }, { width: 1000, height: 600 })).toEqual({ x: 752, y: 372 })
  expect(clampMenuPoint({ x: 10, y: 10 }, { width: 1000, height: 600 })).toEqual({ x: 10, y: 10 })
})

test("never goes negative on tiny viewports", () => {
  expect(clampMenuPoint({ x: 5, y: 5 }, { width: 200, height: 180 })).toEqual({ x: 8, y: 8 })
})
