import { describe, expect, test } from "bun:test"
import type { MafwProvider } from "@mafw/sdk"
import { modelName } from "./model-name"

const providers = new Map<string, MafwProvider>([
  [
    "anthropic",
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { id: "claude-opus-4", name: "Claude Opus 4" },
      ],
    },
  ],
])

describe("modelName", () => {
  test("resolves a model name from the array-shaped provider models", () => {
    expect(modelName(providers, { providerID: "anthropic", modelID: "claude-sonnet-4" })).toBe("Claude Sonnet 4")
  })

  test("falls back to the model id when the provider or model is unknown", () => {
    expect(modelName(providers, { providerID: "unknown", modelID: "m1" })).toBe("m1")
    expect(modelName(providers, { providerID: "anthropic", modelID: "m2" })).toBe("m2")
    expect(modelName(undefined, { providerID: "anthropic", modelID: "m1" })).toBe("m1")
  })

  test("returns an empty label without a model id", () => {
    expect(modelName(providers, undefined)).toBe("")
    expect(modelName(providers, { providerID: "anthropic", modelID: "" })).toBe("")
  })
})
