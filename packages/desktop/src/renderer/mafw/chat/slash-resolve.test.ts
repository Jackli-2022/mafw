import { describe, expect, test } from "bun:test"
import { resolveSlash } from "./slash-resolve"

const base = {
  mafwNames: new Set(["goal"]),
  runtime: [{ name: "review", agent: "plan" }],
  skills: [{ id: "superpowers" }, { id: "review" }],
}

describe("resolveSlash", () => {
  test("non-slash / unknown → null", () => {
    expect(resolveSlash("hello", base)).toBeNull()
    expect(resolveSlash("/nope", base)).toBeNull()
  })

  test("mafw > runtime > skill on the same name", () => {
    expect(resolveSlash("/goal x", base)).toEqual({ kind: "mafw", name: "goal" })
    expect(resolveSlash("/review x", base)).toEqual({ kind: "runtime", name: "review", agent: "plan" })
    expect(resolveSlash("/superpowers x", base)).toEqual({ kind: "skill", name: "superpowers" })
  })

  test("case-insensitive and canonical name", () => {
    expect(resolveSlash("/REVIEW", base)).toEqual({ kind: "runtime", name: "review", agent: "plan" })
    expect(resolveSlash("/SuperPowers", base)).toEqual({ kind: "skill", name: "superpowers" })
  })
})
