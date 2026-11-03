// Task 8 fix regression: panel request bookkeeping must be non-reactive.
//
// The identity effect inside `PluginPanelSurface` calls `loader.load()`. If the
// loader read its own state signal while preparing the request token, every
// settle would re-run that effect and issue another `plugins.invoke` — an
// infinite fetch loop on success and on failure. `createRoot` + `createEffect`
// exercises the same Solid scheduling headlessly (no DOM needed).
import { describe, expect, test } from "bun:test"
// Node resolves `solid-js` to its SSR build where createEffect is a no-op; use
// the browser reactive build for the effect/loop regression and pass it into
// the loader through its runtime seam.
import { createEffect, createRoot, createSignal, untrack } from "solid-js/dist/solid.js"
import type { PluginGeneration } from "./plugin-client"
import { createPluginPanelLoader, type PluginPanelLoaderRuntime } from "./plugin-panel-loader"

const browserRuntime = { createSignal, untrack } as unknown as PluginPanelLoaderRuntime

const generation = (revision: string): PluginGeneration => {
  const separator = revision.lastIndexOf(":")
  return {
    bootId: separator > 0 ? revision.slice(0, separator) : revision,
    counter: separator > 0 ? Number(revision.slice(separator + 1)) : 0,
    revision,
  }
}

const view = (title: string) => ({
  title,
  body: [{ type: "text" as const, text: title }],
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("createPluginPanelLoader", () => {
  test("settling a view never re-triggers the identity effect (one fetch, no loop)", async () => {
    const [revision, setRevision] = createSignal(1)
    let calls = 0
    let loader!: ReturnType<typeof createPluginPanelLoader>
    const dispose = createRoot((disposeRoot) => {
      loader = createPluginPanelLoader({
        invoke: async () => {
          calls += 1
          return view(`v${calls}`)
        },
        generation: () => generation("boot-a:1"),
        isGenerationCurrent: () => true,
      }, browserRuntime)
      createEffect(() => {
        revision()
        void loader.load()
      })
      return disposeRoot
    })

    await flush()
    expect(calls).toBe(1)
    expect(loader.state().status).toBe("ready")
    expect(loader.state().view?.title).toBe("v1")

    // Extra turns prove the settle write did not schedule another fetch.
    await flush()
    await flush()
    expect(calls).toBe(1)

    setRevision(2)
    await flush()
    expect(calls).toBe(2)
    expect(loader.state().view?.title).toBe("v2")

    // Explicit refresh (refreshOn subscription path) is still exactly one call.
    await loader.load()
    expect(calls).toBe(3)

    dispose()
  })

  test("failures also settle without looping", async () => {
    const [revision, setRevision] = createSignal(1)
    let calls = 0
    let loader!: ReturnType<typeof createPluginPanelLoader>
    const dispose = createRoot((disposeRoot) => {
      loader = createPluginPanelLoader({
        invoke: async () => {
          calls += 1
          throw new Error("boom")
        },
        generation: () => generation("boot-a:1"),
        isGenerationCurrent: () => true,
      }, browserRuntime)
      createEffect(() => {
        revision()
        void loader.load()
      })
      return disposeRoot
    })

    await flush()
    expect(calls).toBe(1)
    expect(loader.state().status).toBe("error")
    expect(loader.state().error).toBe("boom")

    await flush()
    await flush()
    expect(calls).toBe(1)

    setRevision(2)
    await flush()
    expect(calls).toBe(2)
    dispose()
  })

  test("stale generation responses are discarded", async () => {
    let current = true
    let loader!: ReturnType<typeof createPluginPanelLoader>
    const dispose = createRoot((disposeRoot) => {
      loader = createPluginPanelLoader({
        invoke: async () => {
          current = false // generation changes while in flight
          return view("stale")
        },
        generation: () => generation("boot-a:1"),
        isGenerationCurrent: () => current,
      }, browserRuntime)
      return disposeRoot
    })

    await loader.load()
    expect(loader.state().status).toBe("loading")
    expect(loader.state().view).toBeNull()
    dispose()
  })

  test("a newer request discards the slower older response", async () => {
    const resolvers: Array<(value: unknown) => void> = []
    let loader!: ReturnType<typeof createPluginPanelLoader>
    const dispose = createRoot((disposeRoot) => {
      loader = createPluginPanelLoader({
        invoke: () =>
          new Promise<unknown>((resolve) => {
            resolvers.push(resolve)
          }),
        generation: () => generation("boot-a:1"),
        isGenerationCurrent: () => true,
      }, browserRuntime)
      return disposeRoot
    })

    const first = loader.load()
    const second = loader.load()
    expect(resolvers).toHaveLength(2)

    resolvers[0]?.(view("old"))
    await first
    expect(loader.state().status).toBe("loading")

    resolvers[1]?.(view("new"))
    await second
    expect(loader.state().status).toBe("ready")
    expect(loader.state().view?.title).toBe("new")
    dispose()
  })
})
