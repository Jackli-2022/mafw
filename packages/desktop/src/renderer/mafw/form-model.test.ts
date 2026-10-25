import { describe, expect, test } from "bun:test"
import { initialAnswers, isQuestionComplete, isQuestionSatisfied, serializeAnswers, visibleQuestions } from "./form-model"

const q = (over: any) => ({ id: "x", ...over })

describe("visibleQuestions", () => {
  test("when eq/neq", () => {
    const questions = [
      q({ id: "agree", type: "boolean" }),
      q({ id: "yes", when: [{ key: "agree", op: "eq", value: true }] }),
      q({ id: "no", when: [{ key: "agree", op: "neq", value: true }] }),
    ]
    expect(visibleQuestions(questions, { agree: ["true"] }).map(x => x.id)).toEqual(["agree", "yes"])
    expect(visibleQuestions(questions, { agree: ["false"] }).map(x => x.id)).toEqual(["agree", "no"])
    expect(visibleQuestions(questions, {}).map(x => x.id)).toEqual(["agree", "no"])
  })

  test("hidden dependency treated as empty", () => {
    const questions = [q({ id: "x", when: [{ key: "missing", op: "neq", value: "y" }] })]
    expect(visibleQuestions(questions, {}).map(x => x.id)).toEqual(["x"])
  })
})

describe("initialAnswers", () => {
  test("defaults by type; external never defaults true", () => {
    expect(initialAnswers([
      q({ id: "a", type: "string", default: "hi" }),
      q({ id: "b", type: "boolean", default: true }),
      q({ id: "c", type: "multiselect", default: ["x", "y"] }),
      q({ id: "d", type: "external", default: true }),
    ])).toEqual({ a: ["hi"], b: ["true"], c: ["x", "y"] })
  })
})

describe("completeness", () => {
  test("required/optional/number/external", () => {
    expect(isQuestionSatisfied(q({ id: "s", type: "string", required: true }), [])).toBe(false)
    expect(isQuestionSatisfied(q({ id: "s", type: "string", required: false }), [])).toBe(true)
    expect(isQuestionComplete(q({ id: "n", type: "integer", minimum: 2, maximum: 4 }), ["3"])).toBe(true)
    expect(isQuestionComplete(q({ id: "n", type: "integer", minimum: 2, maximum: 4 }), ["5"])).toBe(false)
    expect(isQuestionComplete(q({ id: "n", type: "integer" }), ["3.5"])).toBe(false)
    expect(isQuestionSatisfied(q({ id: "e", type: "external", required: false }), [])).toBe(false)
    expect(isQuestionSatisfied(q({ id: "e", type: "external" }), ["true"])).toBe(true)
  })

  test("string pattern/length", () => {
    expect(isQuestionComplete(q({ id: "s", type: "string", pattern: "^A", minLength: 2 }), ["Ab"])).toBe(true)
    expect(isQuestionComplete(q({ id: "s", type: "string", pattern: "^A" }), ["ba"])).toBe(false)
  })
})

describe("serializeAnswers", () => {
  test("keeps question order and empties for hidden answers", () => {
    const questions = [q({ id: "a" }), q({ id: "b" }), q({ id: "c" })]
    expect(serializeAnswers(questions, { a: ["1"], c: ["3"] })).toEqual([["1"], [], ["3"]])
  })
})
