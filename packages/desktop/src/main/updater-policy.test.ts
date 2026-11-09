import { describe, expect, test } from "bun:test"
import { resolveUpdateSupport } from "./updater-policy"

describe("resolveUpdateSupport", () => {
  test("dev and unpackaged builds are disabled", () => {
    expect(resolveUpdateSupport({
      packaged: true,
      channel: "dev",
      platform: "win32",
      appImagePath: null,
    })).toEqual({ enabled: false, reason: "dev" })
    expect(resolveUpdateSupport({
      packaged: false,
      channel: "prod",
      platform: "win32",
      appImagePath: null,
    })).toEqual({ enabled: false, reason: "not-packaged" })
  })

  test("prod and beta use their matching update channels", () => {
    expect(resolveUpdateSupport({
      packaged: true,
      channel: "prod",
      platform: "win32",
      appImagePath: null,
    })).toEqual({ enabled: true, channel: "latest" })
    expect(resolveUpdateSupport({
      packaged: true,
      channel: "beta",
      platform: "darwin",
      appImagePath: null,
    })).toEqual({ enabled: true, channel: "beta" })
  })

  test("Linux auto-update is limited to AppImage", () => {
    expect(resolveUpdateSupport({
      packaged: true,
      channel: "prod",
      platform: "linux",
      appImagePath: null,
    })).toEqual({ enabled: false, reason: "linux-package" })
    expect(resolveUpdateSupport({
      packaged: true,
      channel: "prod",
      platform: "linux",
      appImagePath: "/tmp/MAFW.AppImage",
    })).toEqual({ enabled: true, channel: "latest" })
  })
})
