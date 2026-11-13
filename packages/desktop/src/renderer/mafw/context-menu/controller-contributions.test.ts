import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createMenuController } from "./controller"
import { MenuContributionRegistry } from "./contributions"
import { item } from "./model"

describe("menu controller contributions", () => {
  beforeEach(() => {
    ;(globalThis as any).window = { innerWidth: 1024, innerHeight: 768 }
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  test("merges contributions and routes their ids before the built-in run", () => {
    const registry = new MenuContributionRegistry()
    const seen: unknown[] = []
    registry.register({
      id: "ping",
      surface: "message",
      label: "Ping",
      run: (context) => {
        seen.push(context.target)
      },
    })
    const controller = createMenuController({ contributions: registry })
    const run = jest.fn()

    controller.request(
      () => ({ surface: "message", items: [item("message.copy", "复制")] }),
      { id: "m1" },
      run,
      { point: { x: 10, y: 10 } },
    )

    const request = controller.current()
    expect(request).not.toBeNull()
    expect(request!.model.items.some((entry) => entry.type === "group")).toBe(true)
    request!.run("contrib:ping")
    expect(seen).toEqual([{ id: "m1" }])
    expect(run).not.toHaveBeenCalled()

    request!.run("message.copy")
    expect(run).toHaveBeenCalledWith("message.copy")
  });
});
