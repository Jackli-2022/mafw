import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

// 2026-09-20: removed the "keeps a hidden prod launcher for old Linux pins"
// case — it referenced resources/linux/opencode-desktop.desktop, which no
// longer exists in the repo (documented known-bad in AGENTS.md §6.6).

const channels = [
  { channel: "dev", appId: "ai.mafw.desktop.dev", productName: "MAFW Dev", protocolName: "MAFW" },
  { channel: "beta", appId: "ai.mafw.desktop.beta", productName: "MAFW Beta", protocolName: "MAFW Beta" },
  { channel: "prod", appId: "ai.mafw.desktop", productName: "MAFW", protocolName: "MAFW" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toBe(channel.productName)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.artifactName).toBe("mafw-desktop-${os}-${arch}.${ext}")
    expect(config.protocols?.name).toBe(channel.protocolName)
    expect(config.protocols?.schemes).toEqual(["mafw"])
  })
}

test("ships the staged gateway bundle as an extra resource", async () => {
  const module = await import("./electron-builder.config.ts?gateway-bundle=1")
  const config = module.default as Configuration

  const resources = (config.extraResources ?? []) as Array<{ from: string; to: string }>
  expect(resources).toContainEqual({ from: "gateway-bundle/", to: "gateway/" })
})

test("stages channel icons next to the executable for runtime icon paths", async () => {
  const module = await import("./electron-builder.config.ts?icons=1")
  const config = module.default as Configuration

  const resources = (config.extraResources ?? []) as Array<{ from: string; to: string }>
  expect(resources).toContainEqual({ from: "resources/icons", to: "icons" })
})
