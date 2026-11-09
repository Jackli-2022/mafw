import { describe, expect, test } from "bun:test"
import { createQuitCoordinator } from "./quit-coordinator"

describe("quit coordinator", () => {
  test("normal quit awaits gateway stop before quitting", async () => {
    const calls: string[] = []
    const coordinator = createQuitCoordinator({
      stopGateway: async () => {
        calls.push("stop")
      },
      getUpdateReady: () => false,
      installUpdate: async () => {
        calls.push("install")
      },
      quit: () => calls.push("quit"),
    })

    await coordinator.requestQuit()

    expect(calls).toEqual(["stop", "quit"])
    expect(coordinator.isQuitting()).toBe(true)
  })

  test("ready update uses the updater install path instead of the normal quit path", async () => {
    const calls: string[] = []
    const coordinator = createQuitCoordinator({
      stopGateway: async () => {
        calls.push("stop")
      },
      getUpdateReady: () => true,
      installUpdate: async () => {
        calls.push("install")
      },
      quit: () => calls.push("quit"),
    })

    await coordinator.requestQuit()

    expect(calls).toEqual(["install"])
    expect(coordinator.isQuitting()).toBe(true)
  })

  test("concurrent quit requests share one stop/install sequence", async () => {
    const calls: string[] = []
    let releaseStop!: () => void
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const coordinator = createQuitCoordinator({
      stopGateway: async () => {
        calls.push("stop")
        await stopped
      },
      getUpdateReady: () => false,
      installUpdate: async () => {
        calls.push("install")
      },
      quit: () => calls.push("quit"),
    })

    const first = coordinator.requestQuit()
    const second = coordinator.requestQuit()
    expect(second).toBe(first)
    releaseStop()
    await Promise.all([first, second])

    expect(calls).toEqual(["stop", "quit"])
  })

  test("install rejection reports the error and leaves the app running", async () => {
    const errors: unknown[] = []
    const coordinator = createQuitCoordinator({
      stopGateway: async () => {},
      getUpdateReady: () => true,
      installUpdate: async () => {
        throw new Error("install failed")
      },
      quit: () => {
        throw new Error("must not quit")
      },
      onError: (error) => errors.push(error),
    })

    await coordinator.requestQuit()

    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain("install failed")
    expect(coordinator.isQuitting()).toBe(false)
  })
})
