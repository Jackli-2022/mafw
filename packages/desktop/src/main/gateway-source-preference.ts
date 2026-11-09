import type { GatewaySourcePreference } from "./gateway-handshake"

const SOURCE_KEY = "source"
let legacyExternalOnce = false
let sessionSourcePreference: GatewaySourcePreference | null = null

export function readGatewaySourcePreference(store: { get(key: string): unknown }): GatewaySourcePreference {
  return store.get(SOURCE_KEY) === "external" ? "external" : "managed"
}

export function writeGatewaySourcePreference(
  store: { set(key: string, value: unknown): void },
  value: GatewaySourcePreference,
): void {
  store.set(SOURCE_KEY, value === "external" ? "external" : "managed")
  sessionSourcePreference = null
}

export function readEffectiveGatewaySourcePreference(
  store: { get(key: string): unknown },
): GatewaySourcePreference {
  return sessionSourcePreference ?? readGatewaySourcePreference(store)
}

export function useLegacyExternalSession(): void {
  sessionSourcePreference = "external"
  allowLegacyExternalOnce()
}

export function hasLegacyExternalSession(): boolean {
  return sessionSourcePreference === "external"
}

export function clearSessionSourcePreference(): void {
  sessionSourcePreference = null
}

export function resetSessionSourcePreferenceForTests(): void {
  sessionSourcePreference = null
  legacyExternalOnce = false
}

export function allowLegacyExternalOnce(): void {
  legacyExternalOnce = true
}

export function consumeLegacyExternalOnce(): boolean {
  const allowed = legacyExternalOnce
  legacyExternalOnce = false
  return allowed
}
