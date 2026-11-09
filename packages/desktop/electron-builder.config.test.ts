import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

// 2026-09-20: removed the "keeps a hidden prod launcher for old Linux pins"
// case 鈥?it referenced resources/linux/opencode-desktop.desktop, which no
// longer exists in the repo (documented known-bad in AGENTS.md 搂6.6).

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

test("Windows updates require a valid code signature", async () => {
  const module = await import("./electron-builder.config.ts?update-signature=1")
  const config = module.default as Configuration
  expect(config.win?.verifyUpdateCodeSignature).toBe(true)
})

test("self-sign mode pins the dev certificate and forces signing", async () => {
  const previousFlag = process.env.MAFW_WIN_SELF_SIGN
  const previousSubject = process.env.MAFW_WIN_SELF_SIGN_SUBJECT
  process.env.MAFW_WIN_SELF_SIGN = "1"
  delete process.env.MAFW_WIN_SELF_SIGN_SUBJECT
  try {
    const module = await import("./electron-builder.config.ts?self-sign=1")
    const config = module.default as Configuration

    expect(config.win?.signtoolOptions?.certificateSubjectName).toBe("MAFW Dev")
    expect(config.win?.signtoolOptions?.publisherName).toBe("CN=MAFW Dev")
    expect(config.win?.signtoolOptions?.signingHashAlgorithms).toEqual(["sha256"])
    expect(config.forceCodeSigning).toBe(true)
    // Self-signing must not weaken update verification.
    expect(config.win?.verifyUpdateCodeSignature).toBe(true)
  } finally {
    if (previousFlag === undefined) delete process.env.MAFW_WIN_SELF_SIGN
    else process.env.MAFW_WIN_SELF_SIGN = previousFlag
    if (previousSubject === undefined) delete process.env.MAFW_WIN_SELF_SIGN_SUBJECT
    else process.env.MAFW_WIN_SELF_SIGN_SUBJECT = previousSubject
  }
})

test("self-sign mode honours a custom subject", async () => {
  const previousFlag = process.env.MAFW_WIN_SELF_SIGN
  const previousSubject = process.env.MAFW_WIN_SELF_SIGN_SUBJECT
  process.env.MAFW_WIN_SELF_SIGN = "1"
  process.env.MAFW_WIN_SELF_SIGN_SUBJECT = "MAFW Internal"
  try {
    const module = await import("./electron-builder.config.ts?self-sign-subject=1")
    const config = module.default as Configuration
    expect(config.win?.signtoolOptions?.certificateSubjectName).toBe("MAFW Internal")
    expect(config.win?.signtoolOptions?.publisherName).toBe("CN=MAFW Internal")
  } finally {
    if (previousFlag === undefined) delete process.env.MAFW_WIN_SELF_SIGN
    else process.env.MAFW_WIN_SELF_SIGN = previousFlag
    if (previousSubject === undefined) delete process.env.MAFW_WIN_SELF_SIGN_SUBJECT
    else process.env.MAFW_WIN_SELF_SIGN_SUBJECT = previousSubject
  }
})

test("release builds stay unsigned unless self-sign mode is enabled", async () => {
  const previousFlag = process.env.MAFW_WIN_SELF_SIGN
  delete process.env.MAFW_WIN_SELF_SIGN
  try {
    const module = await import("./electron-builder.config.ts?release-unsigned=1")
    const config = module.default as Configuration
    expect(config.win?.signtoolOptions?.certificateSubjectName).toBeUndefined()
    expect(config.win?.signtoolOptions?.publisherName).toBeUndefined()
    expect(config.win?.signtoolOptions?.signingHashAlgorithms).toBeUndefined()
    expect(config.forceCodeSigning).toBeFalsy()
    expect(config.win?.verifyUpdateCodeSignature).toBe(true)
  } finally {
    if (previousFlag !== undefined) process.env.MAFW_WIN_SELF_SIGN = previousFlag
  }
})

test("stages channel icons next to the executable for runtime icon paths", async () => {
  const module = await import("./electron-builder.config.ts?icons=1")
  const config = module.default as Configuration

  const resources = (config.extraResources ?? []) as Array<{ from: string; to: string }>
  expect(resources).toContainEqual({ from: "resources/icons", to: "icons" })
})
