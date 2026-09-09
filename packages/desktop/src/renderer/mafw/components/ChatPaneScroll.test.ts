import { describe, expect, test } from "bun:test"
import { scrollPinDecision } from "./ChatPaneScroll"

const THRESHOLD = 120

const at = (scrollTop: number, prevScrollTop: number, scrollHeight = 2000, clientHeight = 1000) =>
  scrollPinDecision({ prevScrollTop, scrollTop, scrollHeight, clientHeight, snapThreshold: THRESHOLD })

describe("scrollPinDecision", () => {
  test("releases the pin when scrolling up from the very bottom", () => {
    expect(at(980, 1000)).toBe(false)
  })
  test("stays unpinned while continuing upward", () => {
    expect(at(500, 980)).toBe(false)
  })
  test("re-pins when the user scrolls all the way back to the bottom", () => {
    expect(at(1000, 500)).toBe(true)
  })
  test("stays unpinned when still far above the bottom", () => {
    expect(at(800, 500)).toBe(false)
  })
  test("stays pinned when at the bottom without an upward move", () => {
    expect(at(1000, 1000)).toBe(true)
  })
  test("re-pins when scrolling down into the snap zone", () => {
    expect(at(930, 700)).toBe(true)
  })
})