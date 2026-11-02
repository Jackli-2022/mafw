// Task 10: unified tool-card registration/restore/claim controller tests.
//
// The controller is Solid-free and fully injectable: production wires
// ToolRegistry + the legacy IPC list, tests wire a plain Map. This pins slot
// ownership across revisions (the `override` leak regression), restoration on
// descriptor removal, claim release and legacy reclaim.
import { describe, expect, test } from "bun:test"
import type {
  PluginClientDescriptor,
  PluginToolCardDescriptor,
} from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import { createUnifiedToolCardController } from "./plugin-tool-card-registry"

const BOOT: PluginGeneration = { bootId: "boot-a", counter: 1, revision: "boot-a:1" }

function card(over: Partial<PluginToolCardDescriptor> = {}): PluginToolCardDescriptor {
  return { id: "card", tools: ["bash"], viewAction: "view", ...over }
}

function descriptor(name: string, cards: PluginToolCardDescriptor[]): PluginClientDescriptor {
  return {
    name,
    version: "1.0.0",
    revision: `${name}-rev:1`,
    ui: { toolCards: cards },
    actions: [...new Set(cards.map((entry) => entry.viewAction))].map((action) => ({ name: action })),
    events: [],
  }
}

interface HarnessOptions {
  builtins?: Record<string, string>
  legacy?: string[]
  /** Simulate legacy cards already registered (default true when legacy given). */
  legacyApplied?: boolean
}

function harness(options: HarnessOptions = {}) {
  const registry = new Map<string, string>(Object.entries(options.builtins ?? {}))
  const claims = new Set<string>()
  const declaredLegacy = new Set(options.legacy ?? [])
  // legacy target → restored original card
  const legacyOriginals = new Map<string, string | undefined>()
  const released: string[] = []
  const bound: Array<{ target: string; package: string; card: string; fallback?: string }> = []
  const fallbacks: Array<string | undefined> = []
  let reapplyCount = 0
  let descriptors: PluginClientDescriptor[] = []

  if (options.legacy && options.legacyApplied !== false) {
    for (const tool of declaredLegacy) {
      legacyOriginals.set(tool, registry.get(tool))
      registry.set(tool, "legacy")
    }
  }

  const controller = createUnifiedToolCardController<string>({
    descriptors: () => descriptors,
    generation: () => BOOT,
    isGenerationCurrent: () => true,
    listLegacy: async () => [...declaredLegacy].map((tool) => ({ tool })),
    registry: {
      render: (target) => registry.get(target),
      register: (target, value) => {
        if (value === undefined) registry.delete(target)
        else registry.set(target, value)
      },
    },
    releaseLegacy: (target) => {
      if (!legacyOriginals.has(target)) return undefined
      released.push(target)
      const original = legacyOriginals.get(target)
      legacyOriginals.delete(target)
      if (original === undefined) registry.delete(target)
      else registry.set(target, original)
      return original
    },
    reapplyLegacy: () => {
      reapplyCount += 1
      for (const tool of declaredLegacy) {
        if (claims.has(tool)) continue
        if (legacyOriginals.has(tool)) continue
        const original = registry.get(tool)
        legacyOriginals.set(tool, original)
        registry.set(tool, "legacy")
      }
    },
    setClaims: (targets) => {
      claims.clear()
      for (const target of targets) claims.add(target)
    },
    bind: (entry, fallback) => {
      const value = `unified:${entry.descriptor.name}:${entry.card.id}`
      bound.push({ target: entry.target, package: entry.descriptor.name, card: entry.card.id, fallback })
      fallbacks.push(fallback)
      registry.set(entry.target, value)
    },
  })

  return {
    controller,
    registry,
    claims,
    bound,
    fallbacks,
    released,
    legacyOriginals,
    reapplyCount: () => reapplyCount,
    setDescriptors: (value: PluginClientDescriptor[]) => {
      descriptors = value
    },
  }
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("unified tool-card controller: ownership", () => {
  test("first claim wins; a duplicate unified override is rejected", async () => {
    const h = harness({ builtins: { bash: "builtin" } })
    h.setDescriptors([
      descriptor("aaa", [card({ id: "one", override: true })]),
      descriptor("bbb", [card({ id: "two", override: true })]),
    ])
    expect(await h.controller.apply()).toBe(true)
    const bashOwners = h.bound.filter((entry) => entry.target === "bash")
    expect(bashOwners).toHaveLength(1)
    expect(bashOwners[0]?.package).toBe("aaa")
    expect(h.registry.get("bash")).toBe("unified:aaa:one")
    expect(h.claims.has("bash")).toBe(true)
    // The logical tool owns its whole alias group.
    expect(h.bound).toHaveLength(4)
  })

  test("legacy conflict without override keeps the legacy card", async () => {
    const h = harness({ builtins: { bash: "builtin" }, legacy: ["bash"] })
    h.setDescriptors([descriptor("aaa", [card()])])
    await h.controller.apply()
    expect(h.bound).toHaveLength(0)
    expect(h.registry.get("bash")).toBe("legacy")
    expect(h.claims.size).toBe(0)
    expect(h.released).toEqual([])
  })

  test("override:true releases the legacy card and binds the unified proxy", async () => {
    const h = harness({ builtins: { bash: "builtin" }, legacy: ["bash"] })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    expect(h.released).toEqual(["bash"])
    expect(h.registry.get("bash")).toBe("unified:aaa:card")
    expect(h.bound.find((entry) => entry.target === "bash")?.fallback).toBe("builtin")
    expect(h.claims.has("bash")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

describe("unified tool-card controller: revisions", () => {
  test("removing a descriptor restores the original card and releases claims", async () => {
    const h = harness({ builtins: { bash: "builtin" } })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("unified:aaa:card")

    h.setDescriptors([])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("builtin")
    expect(h.claims.size).toBe(0)
    expect(h.controller.targets()).toEqual([])
    expect(h.bound).toHaveLength(4) // no second bind on removal
  })

  test("override removal on the next revision does not keep the built-in slot or its aliases", async () => {
    const h = harness({ builtins: { bash: "builtin" } })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("unified:aaa:card")

    // Same package/card, override removed: the fallback built-in is occupied,
    // so the whole logical tool (including `shell`/`mafw_*` aliases) is skipped.
    h.setDescriptors([descriptor("aaa", [card()])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("builtin")
    expect(h.claims.size).toBe(0)
    expect(h.bound).toHaveLength(4)
  })

  test("a package swap cannot take a built-in slot still occupied under a removed override", async () => {
    const h = harness({ builtins: { bash: "builtin" } })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("unified:aaa:card")

    // aaa removed, bbb added without override -> built-in still owns the slot.
    h.setDescriptors([descriptor("bbb", [card({ id: "bbb-card" })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("builtin")
    expect(h.claims.size).toBe(0)
    expect(h.bound).toHaveLength(4)

    // bbb with override may take it.
    h.setDescriptors([descriptor("bbb", [card({ id: "bbb-card", override: true })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("unified:bbb:bbb-card")
    expect(h.claims.has("bash")).toBe(true)
  })

  test("legacy reclaims a tool after the unified override disappears", async () => {
    const h = harness({ builtins: { bash: "builtin" }, legacy: ["bash"] })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    expect(h.registry.get("bash")).toBe("unified:aaa:card")
    expect(h.released).toEqual(["bash"])

    h.setDescriptors([])
    await h.controller.apply()
    expect(h.claims.size).toBe(0)
    // The legacy rescan re-registers the declared tool over the built-in.
    expect(h.registry.get("bash")).toBe("legacy")
    expect(h.legacyOriginals.get("bash")).toBe("builtin")
    expect(h.reapplyCount()).toBe(2)
  })

  test("reset restores every proxy and drops claims", async () => {
    const h = harness({ builtins: { bash: "builtin" } })
    h.setDescriptors([descriptor("aaa", [card({ override: true })])])
    await h.controller.apply()
    h.controller.reset()
    expect(h.registry.get("bash")).toBe("builtin")
    expect(h.claims.size).toBe(0)
    expect(h.controller.targets()).toEqual([])
  })

  test("a stale apply after a newer generation mutates nothing", async () => {
    const registry = new Map<string, string>([["bash", "builtin"]])
    let current = true
    const bound: string[] = []
    const controller = createUnifiedToolCardController<string>({
      descriptors: () => [descriptor("aaa", [card({ override: true })])],
      generation: () => BOOT,
      isGenerationCurrent: () => current,
      listLegacy: async () => {
        current = false // revision moved while the legacy list was in flight
        return []
      },
      registry: {
        render: (target) => registry.get(target),
        register: (target, value) => {
          if (value === undefined) registry.delete(target)
          else registry.set(target, value)
        },
      },
      releaseLegacy: () => undefined,
      reapplyLegacy: () => {},
      setClaims: () => {},
      bind: (entry) => bound.push(entry.target),
    })
    expect(await controller.apply()).toBe(false)
    expect(bound).toEqual([])
    expect(registry.get("bash")).toBe("builtin")
  })
})
