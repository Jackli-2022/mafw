import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { probeBackgroundApi } from "./background-capability"

/**
 * Regression (2026-11-03): BackgroundDock/BackgroundWorkBar call the capability
 * probes from `createEffect`. The probe used to read `experienceStore.state()`
 * inside that reactive scope, subscribing the effect to the store. The store's
 * `load()` writes `loading` synchronously, so the effect re-entered before the
 * probe's in-flight promise was assigned and recursed until the stack blew
 * (2822 IPC calls + RangeError on every Desktop start).
 */
describe("background capability probes in a reactive scope", () => {
  test("the probe does not subscribe its caller to experience writes", async () => {
    let actions = 0
    ;(globalThis as any).window = {
      api: {
        mafw: {
          experience: {
            actions: async () => {
              actions++
              return { experienceVersion: "2026.11.1", actions: {} }
            },
          },
        },
      },
    }

    let runs = 0
    let dispose = () => {}
    createRoot((d) => {
      dispose = d
      createEffect(() => {
        runs++
        void probeBackgroundApi()
      })
    })

    await new Promise((r) => setTimeout(r, 30))
    dispose()
    delete (globalThis as any).window

    expect(runs).toBe(1)
    expect(actions).toBe(1)
  })
})
