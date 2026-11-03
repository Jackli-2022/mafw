// Final review B finding 1: the shipped example must actually bind its tool
// card under real Desktop occupancy. `bash` already has a built-in session-ui
// card, so a declaration without `override: true` is silently dropped. This
// test loads the real example through `activate()` and resolves it with the
// same model the registry uses, with `bash` marked occupied.
import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import { effectiveToolCardTargets } from "./plugin-tool-card-model"

const EXAMPLE = fileURLToPath(
  new URL("../../../../../../docs/examples/plugins/service-monitor/index.js", import.meta.url),
)

interface ExampleContributions {
  ui: PluginClientDescriptor["ui"]
  actions: Record<string, unknown>
}

interface ExampleModule {
  name: string
  activate(ctx: unknown): Promise<ExampleContributions>
}

const CTX = {
  log: { info() {}, warn() {}, error() {}, debug() {} },
  fetch: async () => {
    throw new Error("the example never performs network requests")
  },
  apiKey: () => null,
  pluginConfig: () => ({}),
  config: { update() {} },
  usage: { modelStats: () => [] },
  emit() {},
}

async function loadExample(): Promise<{
  plugin: ExampleModule
  contributions: ExampleContributions
}> {
  const require = createRequire(import.meta.url)
  const resolved = require.resolve(EXAMPLE)
  delete require.cache[resolved]
  const plugin = require(resolved) as ExampleModule
  const contributions = await plugin.activate(CTX)
  return { plugin, contributions }
}

function descriptor(
  plugin: ExampleModule,
  contributions: ExampleContributions,
): PluginClientDescriptor {
  return {
    name: plugin.name,
    version: "1.0.0",
    revision: "example:1",
    ui: contributions.ui,
    actions: Object.keys(contributions.actions).map((name) => ({ name })),
    events: [],
  }
}

const BUILT_IN_OCCUPANCY = { isOccupied: (target: string) => target === "bash" }

describe("service-monitor example tool card", () => {
  test("declares override so it may replace the built-in bash card", async () => {
    const { contributions } = await loadExample()
    const card = contributions.ui.toolCards?.[0]
    expect(card).toBeDefined()
    expect(card?.override).toBe(true)
  })

  test("binds under real built-in occupancy and claims the whole alias group", async () => {
    const { plugin, contributions } = await loadExample()
    const targets = effectiveToolCardTargets(
      [descriptor(plugin, contributions)],
      [],
      BUILT_IN_OCCUPANCY,
    ).map((entry) => entry.target)

    expect(targets.length).toBeGreaterThan(0)
    expect(targets).toContain("bash")
    // One logical tool owns its whole group or nothing: bash + mafw_bash +
    // shell + mafw_shell are all bound by the same declaration.
    expect(targets).toEqual(
      expect.arrayContaining(["bash", "mafw_bash", "shell", "mafw_shell"]),
    )
  })

  test("the occupancy check is meaningful: dropping override would drop the card", async () => {
    const { plugin, contributions } = await loadExample()
    const base = descriptor(plugin, contributions)
    const stripped: PluginClientDescriptor = {
      ...base,
      ui: {
        ...base.ui,
        toolCards: (base.ui.toolCards ?? []).map((card) => ({ ...card, override: undefined })),
      },
    }
    expect(effectiveToolCardTargets([stripped], [], BUILT_IN_OCCUPANCY)).toEqual([])
  })
})
