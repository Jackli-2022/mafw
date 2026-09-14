import { expect, test } from "bun:test"
import { $ } from "bun"
import type { Configuration } from "electron-builder"

type ResourceEntry = { from: string; to: string; filter?: string[] }

const listResources = async (config: Configuration): Promise<ResourceEntry[]> =>
  (config.extraResources ?? []) as ResourceEntry[]

test("omits native/ extra resource when the directory is absent", async () => {
  const module = await import("./electron-builder.config.ts?native-absent=1")
  const resources = await listResources(module.default as Configuration)
  expect(resources.some((r) => r.to === "native/")).toBe(false)
  expect(resources).toContainEqual({ from: "gateway-bundle/", to: "gateway/" })
})

test("includes native/ extra resource when the directory exists", async () => {
  await $`mkdir -p native`.quiet()
  try {
    await Bun.write("native/index.js", "// marker\n")
    const module = await import("./electron-builder.config.ts?native-present=1")
    const resources = await listResources(module.default as Configuration)
    expect(resources).toContainEqual({
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    })
  } finally {
    await $`rm -rf native`.quiet()
  }
})
