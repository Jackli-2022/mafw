import { describe, expect, test } from "bun:test"
import { annotationRefPart, parseAnnotationRefPart } from "./annotation-message-part"

describe("annotation message refs", () => {
  test("round-trips ids through a hidden synthetic text part", () => {
    const part = annotationRefPart(["ann-1", "ann-2", "ann-1"])
    expect(part).toMatchObject({ type: "text", synthetic: true })
    expect(parseAnnotationRefPart(part)).toEqual(["ann-1", "ann-2"])
  })

  test("ignores unrelated synthetic and malformed parts", () => {
    expect(parseAnnotationRefPart({ type: "text", text: "hello", synthetic: true })).toEqual([])
    expect(parseAnnotationRefPart({ type: "tool", text: "mafw.annotations.v1:[1]" })).toEqual([])
    expect(parseAnnotationRefPart({ type: "text", text: "mafw.annotations.v1:{" })).toEqual([])
    expect(parseAnnotationRefPart(null)).toEqual([])
  })
})
