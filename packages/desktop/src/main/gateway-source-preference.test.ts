import { describe, expect, test } from "bun:test"
import {
  allowLegacyExternalOnce,
  consumeLegacyExternalOnce,
  readGatewaySourcePreference,
  writeGatewaySourcePreference,
} from "./gateway-source-preference"

function memoryStore(initial?: unknown) {
  let value = initial
  return {
    get: () => value,
    set: (_key: string, next: unknown) => {
      value = next
    },
    current: () => value,
  }
}

describe("gateway source preference", () => {
  test("missing or invalid preference falls back to managed", () => {
    expect(readGatewaySourcePreference(memoryStore())).toBe("managed")
    expect(readGatewaySourcePreference(memoryStore("surprise"))).toBe("managed")
  })

  test("managed and external round-trip", () => {
    const store = memoryStore()
    writeGatewaySourcePreference(store, "external")
    expect(store.current()).toBe("external")
    expect(readGatewaySourcePreference(store)).toBe("external")
    writeGatewaySourcePreference(store, "managed")
    expect(readGatewaySourcePreference(store)).toBe("managed")
  })

  test("legacy external override is consumed exactly once", () => {
    expect(consumeLegacyExternalOnce()).toBe(false)
    allowLegacyExternalOnce()
    expect(consumeLegacyExternalOnce()).toBe(true)
    expect(consumeLegacyExternalOnce()).toBe(false)
  })
})
