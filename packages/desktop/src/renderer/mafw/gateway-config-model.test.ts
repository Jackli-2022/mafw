import { describe, expect, test } from "bun:test"
import type { GatewayStatus } from "@mafw/sdk"
import { gatewayConfigView, gatewayConflictGuidance } from "./gateway-config-model"

function status(overrides: Partial<GatewayStatus> = {}): GatewayStatus {
  return {
    state: "ready",
    port: 3000,
    url: "http://127.0.0.1:3000",
    error: null,
    source: "managed",
    expectedVersion: "5.2.0",
    actualVersion: "5.2.0",
    instanceId: "instance-1",
    schemaEpoch: 1,
    distribution: "desktop-managed",
    ...overrides,
  }
}

describe("gatewayConfigView", () => {
  test("managed matching the desktop release is compatible", () => {
    const view = gatewayConfigView(status())
    expect(view.compatibility).toBe("ok")
    expect(view.sourceLabel).toBe("受管 gateway")
    expect(view.versionLabel).toBe("5.2.0")
    expect(view.canRestart).toBe(true)
  })

  test("managed older or newer than the desktop release is a conflict", () => {
    expect(gatewayConfigView(status({ actualVersion: "5.1.9" })).compatibility).toBe("conflict")
    expect(gatewayConfigView(status({ actualVersion: "5.2.1" })).compatibility).toBe("conflict")
    expect(gatewayConfigView(status({ state: "conflict" })).compatibility).toBe("conflict")
  })

  test("external ready is compatible while missing or legacy versions are unknown", () => {
    expect(gatewayConfigView(status({
      source: "external",
      actualVersion: "5.3.0",
      distribution: "standalone",
    })).compatibility).toBe("ok")
    expect(gatewayConfigView(null).compatibility).toBe("unknown")
    expect(gatewayConfigView(status({
      state: "conflict",
      source: "external",
      actualVersion: null,
      distribution: null,
    })).compatibility).toBe("unknown")
  })

  test("conflict enables the managed switch", () => {
    const view = gatewayConfigView(status({
      state: "conflict",
      source: "external",
      actualVersion: null,
    }))
    expect(view.canUseManaged).toBe(true)
    expect(view.canUseExternal).toBe(true)
  })

  test("a quarantined payload permits force retry but not plain restart", () => {
    const view = gatewayConfigView(status({
      state: "conflict",
      quarantine: {
        version: "5.2.0",
        payloadManifestSha256: "abcdef123456",
        error: "native module failed",
        failedAt: "2026-11-09T00:00:00.000Z",
      },
    }))
    expect(view.canRetryQuarantined).toBe(true)
    expect(view.canRestart).toBe(false)
  })

  test("legacy external enables the one-time override only", () => {
    const legacy = gatewayConfigView(status({
      state: "conflict",
      source: "external",
      actualVersion: null,
    }))
    expect(legacy.canUseExternalOnce).toBe(true)
    expect(gatewayConfigView(status()).canUseExternalOnce).toBe(false)
  })
})

describe("gatewayConflictGuidance", () => {
  test("explains quarantine and legacy external states", () => {
    expect(gatewayConflictGuidance(status({
      state: "conflict",
      quarantine: {
        version: "5.2.0",
        payloadManifestSha256: "abcdef123456",
        error: "native module failed",
        failedAt: "2026-11-09T00:00:00.000Z",
      },
    }))).toContain("多次启动失败")
    expect(gatewayConflictGuidance(status({
      state: "conflict",
      source: "external",
      actualVersion: null,
    }))).toContain("仅本次")
    expect(gatewayConflictGuidance(status())).toBeNull()
  })
})
