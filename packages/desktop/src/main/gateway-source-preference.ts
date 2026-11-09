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

/**
 * Reading the preference must never abort Desktop startup: a corrupt
 * electron-store file (e.g. a UTF-8 BOM) throws inside `get()`, and the
 * original call site ran before any try/catch, leaving the app windowless
 * with no error. Fall back to managed and report the error to the caller.
 */
export function safeReadGatewaySourcePreference(
  store: { get(key: string): unknown },
  onError?: (error: unknown) => void,
): GatewaySourcePreference {
  try {
    return readEffectiveGatewaySourcePreference(store)
  } catch (error) {
    onError?.(error)
    return "managed"
  }
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
