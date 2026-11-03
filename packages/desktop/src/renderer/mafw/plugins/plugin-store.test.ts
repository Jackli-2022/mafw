// Task 7: Desktop plugin store (committed descriptors + revision generation).
//
// The store is fed by two neutral surfaces only:
//   - `GET /api/plugins/client` → { revision, plugins } (committed descriptors)
//   - `plugins.changed` { revision } → refresh the snapshot once per revision
//   - `plugin:<package>:<event>` → deliver to registered event subscribers
//
// Revision tokens are opaque `<bootId>:<counter>`; a new bootId always wins even
// with a lower counter (gateway restart), and same-boot lower/equal counters are
// stale and must never roll the store back.
import { beforeEach, describe, expect, test } from "bun:test"
import type { PluginClientDescriptor, PluginClientSnapshot, PluginsListResult } from "@mafw/sdk"
import {
  applyPluginClientSnapshot,
  diffPluginDescriptors,
  ingestPluginEvent,
  ingestPluginsChanged,
  isPluginGenerationCurrent,
  pluginClientRevision,
  pluginDescriptorFor,
  pluginDescriptors,
  pluginDiagnostics,
  pluginGeneration,
  pluginPending,
  refreshPluginClient,
  resetPluginStore,
  subscribePluginEvent,
  type PluginClientTransport,
} from "./plugin-store"

const descriptor = (
  name: string,
  over: Partial<PluginClientDescriptor> = {},
): PluginClientDescriptor => ({
  name,
  version: "1.0.0",
  revision: "boot-a:1",
  ui: {},
  actions: [],
  events: [],
  ...over,
})

const snapshot = (revision: string, plugins: PluginClientDescriptor[]): PluginClientSnapshot => ({
  revision,
  plugins,
})

function makeTransport(
  snapshots: PluginClientSnapshot[],
  inventory?: PluginsListResult,
) {
  const calls = { client: 0, inventory: 0 }
  let index = 0
  const transport: PluginClientTransport = {
    fetchClient: async () => {
      calls.client += 1
      const next = snapshots[Math.min(index, snapshots.length - 1)]
      index += 1
      return next
    },
    fetchInventory: async () => {
      calls.inventory += 1
      return inventory ?? ({ plugins: [] } as PluginsListResult)
    },
  }
  return { transport, calls }
}

const inventory = (rows: Array<Record<string, unknown>>): PluginsListResult =>
  ({ plugins: [], packages: rows } as unknown as PluginsListResult)

beforeEach(() => resetPluginStore())

describe("applyPluginClientSnapshot: generation ordering", () => {
  test("first snapshot builds the baseline", () => {
    const acme = descriptor("acme")
    expect(applyPluginClientSnapshot(snapshot("boot-a:1", [acme]))).toBe(true)
    expect(pluginClientRevision()).toBe("boot-a:1")
    expect(pluginDescriptors().map((d) => d.name)).toEqual(["acme"])
    expect(pluginDescriptorFor("acme")).toBe(acme)
    expect(pluginGeneration()).toMatchObject({ bootId: "boot-a", counter: 1, revision: "boot-a:1" })
  })

  test("same bootId with a higher counter updates", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const next = descriptor("acme", { revision: "boot-a:2", title: "v2" })
    expect(applyPluginClientSnapshot(snapshot("boot-a:2", [next]))).toBe(true)
    expect(pluginClientRevision()).toBe("boot-a:2")
    expect(pluginDescriptorFor("acme")).toBe(next)
  })

  test("a new bootId with a lower counter still updates (gateway restart)", () => {
    applyPluginClientSnapshot(snapshot("boot-a:9", [descriptor("acme")]))
    const next = descriptor("acme", { revision: "boot-b:0", title: "after restart" })
    expect(applyPluginClientSnapshot(snapshot("boot-b:0", [next]))).toBe(true)
    expect(pluginClientRevision()).toBe("boot-b:0")
    expect(pluginDescriptorFor("acme")).toBe(next)
  })

  test("same bootId lower or equal counter is stale and discarded", () => {
    applyPluginClientSnapshot(snapshot("boot-a:5", [descriptor("acme")]))
    const older = descriptor("acme", { revision: "boot-a:2", title: "old" })
    expect(applyPluginClientSnapshot(snapshot("boot-a:2", [older]))).toBe(false)
    expect(applyPluginClientSnapshot(snapshot("boot-a:5", [descriptor("acme", { title: "same" })]))).toBe(false)
    expect(pluginClientRevision()).toBe("boot-a:5")
    expect(pluginDescriptorFor("acme")?.title).toBeUndefined()
  })

  test("invalid snapshot is rejected without clearing the store", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    expect(applyPluginClientSnapshot({ revision: "", plugins: [] } as any)).toBe(false)
    expect(applyPluginClientSnapshot(null as any)).toBe(false)
    expect(pluginClientRevision()).toBe("boot-a:1")
    expect(pluginDescriptors()).toHaveLength(1)
    expect(pluginDiagnostics().some((d) => d.code === "snapshot-invalid")).toBe(true)
  })

  test("an expected bootId mismatch is treated as a stale response", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const next = descriptor("acme", { revision: "boot-a:2" })
    expect(applyPluginClientSnapshot(snapshot("boot-a:2", [next]), "boot-b")).toBe(false)
    expect(pluginClientRevision()).toBe("boot-a:1")
  })
})

describe("applyPluginClientSnapshot: descriptor identity", () => {
  test("unchanged descriptors keep the previous object identity", () => {
    const first = descriptor("acme")
    applyPluginClientSnapshot(snapshot("boot-a:1", [first]))
    // New snapshot, structurally equal but a distinct object.
    const clone = JSON.parse(JSON.stringify(first)) as PluginClientDescriptor
    expect(clone).not.toBe(first)
    expect(applyPluginClientSnapshot(snapshot("boot-a:2", [clone]))).toBe(true)
    expect(pluginClientRevision()).toBe("boot-a:2")
    expect(pluginDescriptorFor("acme")).toBe(first)
  })

  test("changed descriptors replace the object", () => {
    const first = descriptor("acme", { title: "v1" })
    applyPluginClientSnapshot(snapshot("boot-a:1", [first]))
    const changed = descriptor("acme", { revision: "boot-a:2", title: "v2" })
    applyPluginClientSnapshot(snapshot("boot-a:2", [changed]))
    expect(pluginDescriptorFor("acme")).toBe(changed)
  })

  test("removed packages disappear from the keyed store", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme"), descriptor("beta")]))
    applyPluginClientSnapshot(snapshot("boot-a:2", [descriptor("acme")]))
    expect(pluginDescriptors().map((d) => d.name)).toEqual(["acme"])
    expect(pluginDescriptorFor("beta")).toBeUndefined()
  })

  test("an invalid replacement keeps the previous descriptor and reports a diagnostic", () => {
    const first = descriptor("acme", { title: "kept" })
    applyPluginClientSnapshot(snapshot("boot-a:1", [first]))
    const broken = { name: "acme", revision: "boot-a:2" } as unknown as PluginClientDescriptor
    applyPluginClientSnapshot(snapshot("boot-a:2", [broken]))
    expect(pluginClientRevision()).toBe("boot-a:2")
    expect(pluginDescriptorFor("acme")).toBe(first)
    const notice = pluginDiagnostics().find((d) => d.code === "descriptor-invalid")
    expect(notice?.package).toBe("acme")
    expect(notice?.level).toBe("error")
  })
})

describe("diffPluginDescriptors", () => {
  test("classifies added / changed / removed / unchanged and keeps previous identity", () => {
    const acme = descriptor("acme")
    const beta = descriptor("beta")
    const gone = descriptor("gone")
    const nextAcme = descriptor("acme", { revision: "boot-a:2", title: "new" })
    const gamma = descriptor("gamma")
    const diff = diffPluginDescriptors([acme, beta, gone], [nextAcme, gamma])
    expect(diff.added.map((d) => d.name)).toEqual(["gamma"])
    expect(diff.changed.map((d) => d.name)).toEqual(["acme"])
    expect(diff.changed[0]).toBe(nextAcme)
    expect(diff.removed.map((d) => d.name)).toEqual(["beta", "gone"])
    expect(diff.unchanged).toEqual([])
  })

  test("structurally equal descriptors are unchanged and keep the previous object", () => {
    const acme = descriptor("acme")
    const clone = JSON.parse(JSON.stringify(acme)) as PluginClientDescriptor
    const diff = diffPluginDescriptors([acme], [clone])
    expect(diff.unchanged).toEqual([acme])
    expect(diff.unchanged[0]).toBe(acme)
    expect(diff.added).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.removed).toEqual([])
  })
})

describe("refreshPluginClient", () => {
  test("fetches the snapshot and inventory (pending revisions)", async () => {
    const acme = descriptor("acme")
    const { transport, calls } = makeTransport(
      [snapshot("boot-a:1", [acme])],
      inventory([{ name: "acme", enabled: true, pendingRevision: "boot-a:2" }]),
    )
    expect(await refreshPluginClient(transport)).toBe(true)
    expect(calls.client).toBe(1)
    expect(pluginClientRevision()).toBe("boot-a:1")
    expect(pluginPending()).toEqual({ acme: "boot-a:2" })
  })

  test("a failed fetch keeps the previous state and records a diagnostic", async () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const transport: PluginClientTransport = {
      fetchClient: async () => {
        throw new Error("gateway down")
      },
    }
    expect(await refreshPluginClient(transport)).toBe(false)
    expect(pluginClientRevision()).toBe("boot-a:1")
    expect(pluginDescriptors()).toHaveLength(1)
    expect(pluginDiagnostics().some((d) => d.code === "fetch-failed")).toBe(true)
  })

  test("concurrent refreshes coalesce into one snapshot fetch", async () => {
    const { transport, calls } = makeTransport([snapshot("boot-a:1", [descriptor("acme")])])
    await Promise.all([refreshPluginClient(transport), refreshPluginClient(transport)])
    expect(calls.client).toBe(1)
  })
})

describe("ingestPluginsChanged", () => {
  test("one revision change triggers exactly one refresh (duplicates coalesce)", async () => {
    const { transport, calls } = makeTransport([snapshot("boot-a:1", [descriptor("acme")])])
    const event = { type: "plugins.changed", properties: { revision: "boot-a:1" } }
    const first = ingestPluginsChanged(event, transport)
    const second = ingestPluginsChanged(event, transport)
    await Promise.all([first, second])
    expect(calls.client).toBe(1)
    expect(pluginClientRevision()).toBe("boot-a:1")
    // Already at this revision: no further fetch.
    expect(await ingestPluginsChanged(event, transport)).toBe(false)
    expect(calls.client).toBe(1)
  })

  test("a stale (older) revision notification does not fetch", async () => {
    applyPluginClientSnapshot(snapshot("boot-a:5", [descriptor("acme")]))
    const { transport, calls } = makeTransport([snapshot("boot-a:2", [descriptor("acme")])])
    expect(await ingestPluginsChanged({ type: "plugins.changed", properties: { revision: "boot-a:2" } }, transport)).toBe(false)
    expect(calls.client).toBe(0)
  })

  test("a new bootId with a lower counter still refreshes", async () => {
    applyPluginClientSnapshot(snapshot("boot-a:5", [descriptor("acme")]))
    const next = descriptor("acme", { revision: "boot-b:0", title: "restart" })
    const { transport, calls } = makeTransport([snapshot("boot-b:0", [next])])
    expect(await ingestPluginsChanged({ type: "plugins.changed", properties: { revision: "boot-b:0" } }, transport)).toBe(true)
    expect(calls.client).toBe(1)
    expect(pluginDescriptorFor("acme")).toBe(next)
  })

  test("a same-revision state-only change refreshes (pending/error transitions)", async () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const { transport, calls } = makeTransport([snapshot("boot-a:1", [descriptor("acme")])])
    const applied = await ingestPluginsChanged(
      { type: "plugins.changed", properties: { revision: "boot-a:1", stateChanged: true } },
      transport,
    )
    // Pending/error transitions do not move the active revision, but the Hub
    // still needs a fresh `/api/plugins` read.
    expect(applied).toBe(true)
    expect(calls.client).toBe(1)
  })

  test("a normal same-revision commit notification stays deduped", async () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const { transport, calls } = makeTransport([snapshot("boot-a:1", [descriptor("acme")])])
    expect(await ingestPluginsChanged(
      { type: "plugins.changed", properties: { revision: "boot-a:1" } },
      transport,
    )).toBe(false)
    expect(calls.client).toBe(0)
  })
})

describe("stale action response guard", () => {
  test("a generation captured before a newer snapshot is no longer current", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const token = pluginGeneration()
    expect(isPluginGenerationCurrent(token)).toBe(true)
    applyPluginClientSnapshot(snapshot("boot-a:2", [descriptor("acme", { revision: "boot-a:2" })]))
    expect(isPluginGenerationCurrent(token)).toBe(false)
    expect(isPluginGenerationCurrent(pluginGeneration())).toBe(true)
  })

  test("gateway restart invalidates an in-flight action token", () => {
    applyPluginClientSnapshot(snapshot("boot-a:7", [descriptor("acme")]))
    const token = pluginGeneration()
    applyPluginClientSnapshot(snapshot("boot-b:0", [descriptor("acme", { revision: "boot-b:0" })]))
    expect(isPluginGenerationCurrent(token)).toBe(false)
  })
})

describe("ingestPluginEvent", () => {
  const registered = (name: string, type: string) => descriptor(name, {
    events: [{ type, title: "Changed" }],
  })

  test("a registered event reaches only its package's subscribers", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [
      registered("acme", "plugin:acme:changed"),
      registered("beta", "plugin:beta:changed"),
    ]))
    const acmeSeen: any[] = []
    const betaSeen: any[] = []
    const offAcme = subscribePluginEvent("acme:changed", (ev) => acmeSeen.push(ev))
    const offBeta = subscribePluginEvent("beta:changed", (ev) => betaSeen.push(ev))
    const event = { type: "plugin:acme:changed", properties: { value: 1 }, sessionID: "s1" }
    expect(ingestPluginEvent(event)).toBe(true)
    expect(acmeSeen).toEqual([{ type: "plugin:acme:changed", package: "acme", event: "changed", properties: { value: 1 }, sessionID: "s1" }])
    expect(betaSeen).toEqual([])
    offAcme()
    offBeta()
    ingestPluginEvent(event)
    expect(acmeSeen).toHaveLength(1)
  })

  test("events can also be subscribed by full type", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [registered("acme", "plugin:acme:changed")]))
    const seen: string[] = []
    const off = subscribePluginEvent("plugin:acme:changed", (ev) => seen.push(ev.event))
    ingestPluginEvent({ type: "plugin:acme:changed" })
    off()
    expect(seen).toEqual(["changed"])
  })

  test("an unknown package event is a diagnostic, not delivered, and never crashes", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [registered("acme", "plugin:acme:changed")]))
    const seen: string[] = []
    subscribePluginEvent("acme:changed", (ev) => seen.push(ev.type))
    expect(ingestPluginEvent({ type: "plugin:ghost:changed" })).toBe(false)
    expect(seen).toEqual([])
    expect(pluginDiagnostics().some((d) => d.code === "event-unknown-package" && d.package === "ghost")).toBe(true)
  })

  test("an event a package did not register is rejected with a diagnostic", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [registered("acme", "plugin:acme:changed")]))
    const seen: string[] = []
    subscribePluginEvent("acme:undeclared", (ev) => seen.push(ev.type))
    expect(ingestPluginEvent({ type: "plugin:acme:undeclared" })).toBe(false)
    expect(seen).toEqual([])
    expect(pluginDiagnostics().some((d) => d.code === "event-unregistered")).toBe(true)
  })

  test("malformed payloads are consumed defensively (no throw, diagnostic)", () => {
    expect(ingestPluginEvent(null)).toBe(false)
    expect(ingestPluginEvent({ type: "plugin:" })).toBe(false)
    expect(ingestPluginEvent({ type: "plugin:acme" })).toBe(false)
    expect(pluginDiagnostics().some((d) => d.code === "event-malformed")).toBe(true)
  })

  test("events that beat the first snapshot are deferred as info (boot race)", () => {
    expect(ingestPluginEvent({ type: "plugin:acme:changed" })).toBe(false)
    expect(pluginDiagnostics().some((d) => d.code === "event-before-snapshot")).toBe(true)
    expect(pluginDiagnostics().some((d) => d.code === "event-unknown-package")).toBe(false)
  })
})

describe("diagnostics and reset", () => {
  test("descriptor diagnostics are projected into the store diagnostics", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [
      descriptor("acme", { diagnostics: [{ level: "warning", message: "slow view", code: "slow" }] }),
    ]))
    const notice = pluginDiagnostics().find((d) => d.code === "slow")
    expect(notice).toMatchObject({ level: "warning", message: "slow view", package: "acme" })
  })

  test("reset clears signals and subscriptions", () => {
    applyPluginClientSnapshot(snapshot("boot-a:1", [descriptor("acme")]))
    const seen: unknown[] = []
    subscribePluginEvent("acme:changed", (ev) => seen.push(ev))
    resetPluginStore()
    expect(pluginClientRevision()).toBe("")
    expect(pluginDescriptors()).toEqual([])
    expect(pluginPending()).toEqual({})
    expect(pluginDiagnostics()).toEqual([])
  })
})
