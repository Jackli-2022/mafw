import type { CliProbe } from "./mafw-cli-probe"

export type GatewayStartInput = {
  /** URL of an already-running gateway found by probing (highest priority). */
  adoptUrl: string | null
  /** Result of probing the `mafw` CLI on PATH (Hermes-style: user install wins). */
  cliProbe: CliProbe
  /** Entry point of the gateway staged inside the packaged app's resources. */
  bundledEntry: string | null
}

export type GatewayStartPlan =
  | { mode: "adopt"; url: string }
  | { mode: "bundle"; entry: string }
  | { mode: "cli" }
  | { mode: "failed"; reason: string }

/**
 * Decide how the desktop should obtain a gateway, in priority order:
 * adopt a running instance → probed `mafw` CLI on PATH → bundled copy → fail.
 * Kept pure so the sidecar stays a thin shell around this decision.
 */
export function planGatewayStart(input: GatewayStartInput): GatewayStartPlan {
  if (input.adoptUrl) return { mode: "adopt", url: input.adoptUrl }
  if (input.cliProbe.available) return { mode: "cli" }
  if (input.bundledEntry) return { mode: "bundle", entry: input.bundledEntry }
  const cliHint = input.cliProbe.available ? "" : ` (cli probe: ${input.cliProbe.reason})`
  return { mode: "failed", reason: `no running gateway, no usable mafw CLI, no bundled gateway${cliHint}` }
}
