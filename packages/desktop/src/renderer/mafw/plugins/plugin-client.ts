// Task 7: revision/generation primitives and the preload transport for the
// unified plugin client snapshot.
//
// A client revision is an opaque `<bootId>:<counter>` token minted by the
// gateway. The counter is only comparable inside one boot generation: a gateway
// restart mints a fresh bootId and restarts the counter at a lower value, so
// Desktop compares bootId first and only falls back to the counter when the
// bootId is identical (spec §10.4).
import type { PluginClientSnapshot, PluginsListResult } from "@mafw/sdk"

export type { PluginClientDescriptor, PluginClientSnapshot, PluginsListResult } from "@mafw/sdk"

export interface PluginGeneration {
  /** Gateway boot identity (opaque, never persisted by Desktop). */
  bootId: string
  /** Monotonic counter inside one boot; -1 before the first snapshot. */
  counter: number
  /** Full opaque token `<bootId>:<counter>`; "" before the first snapshot. */
  revision: string
}

export const EMPTY_PLUGIN_GENERATION: PluginGeneration = Object.freeze({
  bootId: "",
  counter: -1,
  revision: "",
})

/**
 * Parse an opaque revision token.
 *
 * Returns null for missing/empty tokens. Tokens without a separator are treated
 * as a bootId with counter 0 (defensive: an opaque token is still usable as a
 * generation key, just not ordered).
 */
export function parsePluginRevision(revision: unknown): PluginGeneration | null {
  if (typeof revision !== "string" || revision.length === 0) return null
  const separator = revision.lastIndexOf(":")
  const bootId = separator > 0 ? revision.slice(0, separator) : revision
  if (!bootId) return null
  const counterText = separator > 0 ? revision.slice(separator + 1) : "0"
  const parsed = Number(counterText)
  const counter = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
  return { bootId, counter, revision }
}

/**
 * True when `next` must win over `current`.
 *
 * - No current generation: first snapshot always wins.
 * - Different bootId: a new gateway boot always wins, even with a lower counter.
 * - Same bootId: only a strictly higher counter wins.
 */
export function isNewerPluginGeneration(
  next: PluginGeneration,
  current: PluginGeneration | null | undefined,
): boolean {
  if (!current || !current.revision) return true
  if (next.bootId !== current.bootId) return true
  return next.counter > current.counter
}

export function samePluginGeneration(
  a: PluginGeneration | null | undefined,
  b: PluginGeneration | null | undefined,
): boolean {
  if (!a || !b) return false
  return a.bootId === b.bootId && a.counter === b.counter && a.revision === b.revision
}

/**
 * Neutral client surfaces consumed by the store. Tests inject a fake;
 * production uses the named preload methods (no generic IPC string dispatch).
 */
export interface PluginClientTransport {
  fetchClient(): Promise<PluginClientSnapshot>
  /** Advisory hub inventory (pending revisions). Missing = leave pending as-is. */
  fetchInventory?(): Promise<PluginsListResult>
}

export function defaultPluginClientTransport(): PluginClientTransport {
  return {
    fetchClient: () => window.api.mafw.plugins.client(),
    fetchInventory: () => window.api.mafw.plugins.list(),
  }
}
