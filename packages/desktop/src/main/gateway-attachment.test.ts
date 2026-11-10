import { describe, expect, test } from "bun:test"
import { resolveGatewayAttachment } from "./gateway-attachment"

describe("resolveGatewayAttachment", () => {
  test("ready and not spawned by this desktop is an attachment", () => {
    expect(resolveGatewayAttachment({
      ready: true,
      spawnedByUs: false,
      distribution: "standalone",
    })).toEqual({ attached: true, attachedOrigin: "standalone" })
  })

  test("a managed child spawned by this desktop is not an attachment", () => {
    expect(resolveGatewayAttachment({
      ready: true,
      spawnedByUs: true,
      distribution: "desktop-managed",
    })).toEqual({ attached: false, attachedOrigin: null })
  })

  test("starting or failed is never reported as attached", () => {
    expect(resolveGatewayAttachment({
      ready: false,
      spawnedByUs: false,
      distribution: "standalone",
    })).toEqual({ attached: false, attachedOrigin: null })
  })

  test("missing distribution keeps attachment but reports no origin", () => {
    expect(resolveGatewayAttachment({
      ready: true,
      spawnedByUs: false,
      distribution: null,
    })).toEqual({ attached: true, attachedOrigin: null })
  })
})
