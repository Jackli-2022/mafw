export type GatewayStartInput = {
  /** URL of an already-running gateway found by probing (highest priority). */
  adoptUrl: string | null
  /** Entry point of the gateway staged inside the packaged app's resources. */
  bundledEntry: string | null
  /** Whether the `mafw` CLI is available on PATH (dev fallback). */
  cliAvailable: boolean
}

export type GatewayStartPlan =
  | { mode: "adopt"; url: string }
  | { mode: "bundle"; entry: string }
  | { mode: "cli" }
  | { mode: "failed"; reason: string }

/**
 * Decide how the desktop should obtain a gateway, in priority order:
 * adopt a running instance → spawn the bundled copy → CLI daemon → fail.
 * Kept pure so the sidecar stays a thin shell around this decision.
 */
export function planGatewayStart(input: GatewayStartInput): GatewayStartPlan {
  if (input.adoptUrl) return { mode: "adopt", url: input.adoptUrl }
  if (input.bundledEntry) return { mode: "bundle", entry: input.bundledEntry }
  if (input.cliAvailable) return { mode: "cli" }
  return { mode: "failed", reason: "no running gateway, no bundled gateway, no mafw CLI" }
}
