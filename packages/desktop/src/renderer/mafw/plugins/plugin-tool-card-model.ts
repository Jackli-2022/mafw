// Task 10: unified declarative tool cards — pure model.
//
// Inputs are settled tool parts (or descriptor snapshots) and outputs are plain
// data: the neutral ToolCardModel sent to a package `viewAction`, the resolved
// registry targets for a descriptor set, and the invoke-once lifecycle helpers.
// No Solid, DOM, ToolRegistry or plugin code is imported here, so slot
// resolution and payload limits stay headlessly testable.
import * as contractModule from "@mafw/plugin-contract"
import type {
  PluginClientDescriptor,
  PluginToolCardDescriptor,
  PluginView,
} from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import { samePluginGeneration } from "./plugin-client"
import { toolCardKeys } from "../components/tool-cards/registered-tools"

// The workspace contract package is CommonJS for Node tests but the renderer
// bundle aliases it to the ESM source. Read through the synthetic default so
// both module shapes expose the same API.
const contract =
  (contractModule as unknown as { default?: typeof contractModule }).default ?? contractModule

const MAX_TOOL_PAYLOAD_BYTES = contract.PLUGIN_UI_LIMITS.maxToolPayloadBytes

/** Settled tool part handed to one package `viewAction`. */
export interface ToolCardRenderRequest {
  tool: string
  /** Canonical runtime tool name (gateway enrich field), when known. */
  canonicalTool?: string
  input?: unknown
  output?: unknown
  metadata?: unknown
  status?: string
  sessionID?: string
}

/** Neutral payload the package `viewAction` receives as its raw action input. */
export interface ToolCardModel {
  tool: string
  canonicalTool?: string
  input: unknown
  output?: unknown
  metadata?: unknown
  status: string
  /** True when input/output were shrunk to fit the shared byte budget. */
  truncated: boolean
}

/** Legacy `~/.mafw/ui-plugins` card occupying a tool (from the IPC list). */
export interface LegacyToolCardEntry {
  tool: string
  override?: boolean
}

export interface EffectiveToolCardTarget {
  /** ToolRegistry key the unified proxy is registered under. */
  target: string
  /** Package that owns the card declaration. */
  descriptor: PluginClientDescriptor
  /** The declaring card (declared order within the package is preserved). */
  card: PluginToolCardDescriptor
  /** Stable `<package>:<card>` identity for diagnostics/caching. */
  key: string
}

export interface ToolCardTargetOptions {
  /**
   * True when a built-in (or otherwise non-legacy) card already owns this key.
   * Only a card with `override: true` may replace it. Registration injects
   * `ToolRegistry.render`, tests inject a plain set.
   */
  isOccupied?: (target: string) => boolean
}

// ---------------------------------------------------------------------------
// Slot resolution
// ---------------------------------------------------------------------------

/**
 * Resolve package tool-card declarations into concrete registry keys.
 *
 * Determinism (spec §8.3): packages are visited in snapshot order, cards in
 * declaration order and tools in declared order. The first claimant of a key
 * owns it; a later candidate is rejected — including another `override: true`
 * card — so file/scan order can never silently flip a card. Without
 * `override: true` an already occupied key (built-in or legacy card) is left
 * alone; with it, the unified card replaces the existing card.
 */
export function effectiveToolCardTargets(
  descriptors: readonly PluginClientDescriptor[],
  legacyEntries: readonly LegacyToolCardEntry[] = [],
  options: ToolCardTargetOptions = {},
): EffectiveToolCardTarget[] {
  const occupiedByLegacy = new Set<string>()
  for (const entry of legacyEntries) {
    for (const key of toolCardKeys(entry.tool)) occupiedByLegacy.add(key)
  }
  const isOccupied = options.isOccupied ?? (() => false)
  const claimed = new Set<string>()
  const targets: EffectiveToolCardTarget[] = []

  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== "object") continue
    const cards = descriptor.ui?.toolCards
    if (!Array.isArray(cards)) continue
    for (const card of cards) {
      if (!card || typeof card !== "object") continue
      if (typeof card.viewAction !== "string" || card.viewAction.length === 0) continue
      if (!Array.isArray(card.tools)) continue
      for (const tool of card.tools) {
        if (typeof tool !== "string" || tool.length === 0) continue
        const keys = toolCardKeys(tool)
        for (const key of keys) {
          if (claimed.has(key)) continue
          const isLegacy = occupiedByLegacy.has(key)
          const isBuiltIn = !isLegacy && isOccupied(key)
          if ((isLegacy || isBuiltIn) && card.override !== true) continue
          claimed.add(key)
          targets.push({
            target: key,
            descriptor,
            card,
            key: `${descriptor.name}:${card.id}`,
          })
        }
      }
    }
  }
  return targets
}

// ---------------------------------------------------------------------------
// Invocation lifecycle
// ---------------------------------------------------------------------------

/** Only settled parts may invoke a package view action (spec §8.3). */
export function shouldInvokeToolCard(status: string | undefined): boolean {
  return status === "completed" || status === "error"
}

/**
 * Resource key for one settled part.
 *
 * `null` while pending/running, a stable string once settled: render snapshots
 * that keep growing the output do not re-invoke the plugin (no streaming O(n²)
 * request storm). The tool name is included defensively (a reused component
 * must not show another tool's card) but status/output are not, so the settled
 * snapshot invokes exactly once.
 */
export function toolCardInvocationKey(req: ToolCardRenderRequest): string | null {
  return shouldInvokeToolCard(req.status) ? `settled:${req.tool}` : null
}

/**
 * Invoke-once reducer over the resource key.
 *
 * `invoke` is true exactly on the pending/running → completed/error transition;
 * repeated snapshots of the same settled part return false.
 */
export function planToolCardInvocation(
  previousKey: string | null,
  req: ToolCardRenderRequest,
): { key: string | null; invoke: boolean } {
  const key = toolCardInvocationKey(req)
  return { key, invoke: key !== null && key !== previousKey }
}

/** Stale-response guard for a package action awaited across a revision change. */
export function toolCardResponseCurrent(
  started: PluginGeneration | null | undefined,
  current: PluginGeneration | null | undefined,
): boolean {
  // Boot identity before the first snapshot is the empty generation; two empty
  // tokens are not a committed revision and must never validate a response.
  if (!started || !current || started.revision.length === 0) return false
  return samePluginGeneration(started, current)
}

/** Normalized plugin view (null = invalid output → keep the original card). */
export function toolCardViewOf(raw: unknown): PluginView | null {
  return contract.normalizePluginView(raw)
}

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/**
 * Neutral ToolCardModel for a settled part.
 *
 * `input` + `output` share one 256 KiB JSON budget (`PLUGIN_UI_LIMITS.
 * maxToolPayloadBytes`, the same number the gateway validates). Oversized
 * payloads are shrunk structurally (long strings/arrays/objects are cut) and
 * flagged with `truncated: true` — never thrown, so a huge tool output can only
 * degrade a card, not break the transcript.
 */
export function toolCardModel(req: ToolCardRenderRequest): ToolCardModel {
  const input = req.input === undefined ? {} : req.input
  const output = req.output
  const capped = capPayloads(input, output, MAX_TOOL_PAYLOAD_BYTES)
  const model: ToolCardModel = {
    tool: typeof req.tool === "string" ? req.tool : "",
    input: capped.input,
    status: typeof req.status === "string" && req.status.length > 0 ? req.status : "completed",
    truncated: capped.truncated,
  }
  if (typeof req.canonicalTool === "string" && req.canonicalTool.length > 0) {
    model.canonicalTool = req.canonicalTool
  }
  if (capped.output !== undefined) model.output = capped.output
  if (req.metadata !== undefined) model.metadata = req.metadata
  return model
}

/** UTF-8 JSON byte length used by the payload budget (undefined = 0 bytes). */
export function toolCardPayloadBytes(value: unknown): number {
  if (value === undefined) return 0
  try {
    const json = JSON.stringify(value)
    return typeof json === "string" ? utf8Length(json) : 0
  } catch {
    return 0
  }
}

function capPayloads(
  input: unknown,
  output: unknown,
  limit: number,
): { input: unknown; output: unknown; truncated: boolean } {
  const inputBytes = toolCardPayloadBytes(input)
  const outputBytes = toolCardPayloadBytes(output)
  if (inputBytes + outputBytes <= limit) return { input, output, truncated: false }

  // The tool result (output) yields first so structured arguments survive.
  const outputBudget = Math.max(0, limit - Math.min(inputBytes, limit))
  const nextOutput = output === undefined ? undefined : shrinkValue(output, outputBudget)
  const inputBudget = Math.max(0, limit - toolCardPayloadBytes(nextOutput))
  const nextInput = shrinkValue(input, inputBudget)
  return { input: nextInput, output: nextOutput, truncated: true }
}

function shrinkValue(value: unknown, maxBytes: number): unknown {
  if (maxBytes <= 0) return undefined
  if (toolCardPayloadBytes(value) <= maxBytes) return value
  if (typeof value === "string") return sliceUtf8(value, Math.max(0, maxBytes - 2))
  if (Array.isArray(value)) {
    const out: unknown[] = []
    let used = 2 // []
    for (const item of value) {
      const room = maxBytes - used - 1 // comma
      if (room <= 2) break
      const shrunk = shrinkValue(item, room)
      const size = toolCardPayloadBytes(shrunk)
      if (size > room) break
      out.push(shrunk)
      used += size + (out.length > 1 ? 1 : 0)
      if (used >= maxBytes) break
    }
    return out
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {}
    let used = 2 // {}
    let first = true
    for (const [key, raw] of Object.entries(value)) {
      const keyBytes = toolCardPayloadBytes(key)
      const room = maxBytes - used - keyBytes - 1 - (first ? 0 : 1) // ":" separator + comma
      if (room <= 2) break
      const shrunk = shrinkValue(raw, room)
      const size = toolCardPayloadBytes(shrunk)
      if (size > room) break
      out[key] = shrunk
      used += keyBytes + 1 + size + (first ? 0 : 1)
      first = false
      if (used >= maxBytes) break
    }
    return out
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** Cut a string to at most `maxBytes` UTF-8 bytes without splitting a pair. */
function sliceUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  let bytes = 0
  let end = 0
  while (end < text.length) {
    const code = text.charCodeAt(end)
    let size: number
    let step = 1
    if (code < 0x80) {
      size = 1
    } else if (code < 0x800) {
      size = 2
    } else if (code >= 0xd800 && code <= 0xdbff && end + 1 < text.length) {
      const next = text.charCodeAt(end + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        size = 4
        step = 2
      } else {
        size = 3
      }
    } else {
      size = 3
    }
    if (bytes + size > maxBytes) break
    bytes += size
    end += step
  }
  return end >= text.length ? text : text.slice(0, end)
}
