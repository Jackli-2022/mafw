import type { GatewaySourcePreference } from "./gateway-handshake"

const SOURCE_KEY = "source"
let legacyExternalOnce = false

export function readGatewaySourcePreference(store: { get(key: string): unknown }): GatewaySourcePreference {
  return store.get(SOURCE_KEY) === "external" ? "external" : "managed"
}

export function writeGatewaySourcePreference(
  store: { set(key: string, value: unknown): void },
  value: GatewaySourcePreference,
): void {
  store.set(SOURCE_KEY, value === "external" ? "external" : "managed")
}

export function allowLegacyExternalOnce(): void {
  legacyExternalOnce = true
}

export function consumeLegacyExternalOnce(): boolean {
  const allowed = legacyExternalOnce
  legacyExternalOnce = false
  return allowed
}
