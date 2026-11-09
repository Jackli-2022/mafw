import { describe, expect, test } from "bun:test"
import {
  allowLegacyExternalOnce,
  clearSessionSourcePreference,
  consumeLegacyExternalOnce,
  hasLegacyExternalSession,
  readEffectiveGatewaySourcePreference,
  readGatewaySourcePreference,
  resetSessionSourcePreferenceForTests,
  useLegacyExternalSession,
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
    resetSessionSourcePreferenceForTests()
    expect(consumeLegacyExternalOnce()).toBe(false)
    allowLegacyExternalOnce()
    expect(consumeLegacyExternalOnce()).toBe(true)
    expect(consumeLegacyExternalOnce()).toBe(false)
  })

  test("legacy external session overrides managed without persisting it", () => {
    resetSessionSourcePreferenceForTests()
    try {
      const store = memoryStore("managed")
      useLegacyExternalSession()
      expect(readEffectiveGatewaySourcePreference(store)).toBe("external")
      expect(hasLegacyExternalSession()).toBe(true)
      expect(store.current()).toBe("managed")
      clearSessionSourcePreference()
      expect(hasLegacyExternalSession()).toBe(false)
      expect(readEffectiveGatewaySourcePreference(store)).toBe("managed")
    } finally {
      resetSessionSourcePreferenceForTests()
    }
  })
})
