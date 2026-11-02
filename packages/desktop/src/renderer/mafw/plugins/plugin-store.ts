// Task 7: unified plugin client store.
//
// Owns the committed plugin descriptors projected by
// `GET /api/plugins/client` and routes package events (`plugin:<package>:<event>`)
// to descriptors that declared them. Pure data only: this module never imports
// plugin Host code and never executes package JS.
//
// Revision semantics (spec §10.4):
// - revision is opaque `<bootId>:<counter>`; a new bootId always wins even with
//   a lower counter (gateway restart), same-boot lower/equal counters are stale.
// - every fetch/action caller captures a generation token; responses carrying a
//   superseded generation are discarded instead of overwriting newer UI state.
// - descriptor identity is preserved for structurally unchanged packages so the
//   slot consumers (panels/tool cards/windows) are not re-registered on every
//   revision tick.
import { createSignal } from "solid-js"
import type { PluginClientDescriptor, PluginClientSnapshot, PluginsListResult } from "@mafw/sdk"
import {
  EMPTY_PLUGIN_GENERATION,
  defaultPluginClientTransport,
  isNewerPluginGeneration,
  parsePluginRevision,
  type PluginClientTransport,
  type PluginGeneration,
} from "./plugin-client"

export type { PluginClientDescriptor, PluginClientSnapshot, PluginsListResult, PluginClientTransport, PluginGeneration }

export interface PluginDiagnosticNotice {
  level: "error" | "warning" | "info"
  message: string
  code: string
  package?: string
  revision?: string
  /** Where the notice came from (descriptor payload vs transport/router). */
  source: "descriptor" | "transport" | "router"
}

export interface PluginDescriptorDiff {
  added: PluginClientDescriptor[]
  /** Replacement descriptors from `next` (new object). */
  changed: PluginClientDescriptor[]
  removed: PluginClientDescriptor[]
  /** `prev` objects kept verbatim — identity is the point of this bucket. */
  unchanged: PluginClientDescriptor[]
}

interface PluginDescriptorState {
  generation: PluginGeneration | null
  byName: Record<string, PluginClientDescriptor>
  order: string[]
}

const EMPTY_STATE: PluginDescriptorState = { generation: null, byName: {}, order: [] }
const MAX_DIAGNOSTICS = 100

const [state, setState] = createSignal<PluginDescriptorState>(EMPTY_STATE)
const [pending, setPending] = createSignal<Record<string, string>>({})
const [notices, setNotices] = createSignal<PluginDiagnosticNotice[]>([])

const subscribers = new Map<string, Set<(event: PluginEventNotice) => void>>()
const seenRouterNotices = new Set<string>()

let fetchSequence = 0
let inflightRefresh: Promise<boolean> | null = null

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Current committed client revision token (`""` before the first snapshot). */
export function pluginClientRevision(): string {
  return state().generation?.revision ?? ""
}

/** Committed descriptors in snapshot order (unchanged entries keep identity). */
export function pluginDescriptors(): PluginClientDescriptor[] {
  const snapshot = state()
  const out: PluginClientDescriptor[] = []
  for (const name of snapshot.order) {
    const descriptor = snapshot.byName[name]
    if (descriptor) out.push(descriptor)
  }
  return out
}

export function pluginDescriptorFor(name: string): PluginClientDescriptor | undefined {
  return state().byName[name]
}

/** Package name → staged candidate revision awaiting `apply`. */
export function pluginPending(): Record<string, string> {
  return { ...pending() }
}

/** Descriptor diagnostics + transport/router warnings (newest last, capped). */
export function pluginDiagnostics(): PluginDiagnosticNotice[] {
  return [...notices()]
}

/** Generation captured by a view/action caller before awaiting a response. */
export function pluginGeneration(): PluginGeneration {
  return state().generation ?? EMPTY_PLUGIN_GENERATION
}

/** Stale response guard: false once the store moved to another generation. */
export function isPluginGenerationCurrent(
  token: PluginGeneration | null | undefined,
): boolean {
  if (!token) return false
  const current = state().generation
  if (!current) return false
  return token.bootId === current.bootId
    && token.counter === current.counter
    && token.revision === current.revision
}

// ---------------------------------------------------------------------------
// Pure descriptor helpers
// ---------------------------------------------------------------------------

export function samePluginDescriptor(
  a: PluginClientDescriptor | null | undefined,
  b: PluginClientDescriptor | null | undefined,
): boolean {
  return deepEqual(a, b)
}

export function diffPluginDescriptors(
  prev: readonly PluginClientDescriptor[],
  next: readonly PluginClientDescriptor[],
): PluginDescriptorDiff {
  const prevByName = new Map<string, PluginClientDescriptor>()
  for (const descriptor of prev) prevByName.set(descriptor.name, descriptor)
  const added: PluginClientDescriptor[] = []
  const changed: PluginClientDescriptor[] = []
  const unchanged: PluginClientDescriptor[] = []
  const nextNames = new Set<string>()
  for (const candidate of next) {
    nextNames.add(candidate.name)
    const before = prevByName.get(candidate.name)
    if (!before) {
      added.push(candidate)
    } else if (samePluginDescriptor(before, candidate)) {
      // Keep the previous object: downstream registration diffs stay no-ops.
      unchanged.push(before)
    } else {
      changed.push(candidate)
    }
  }
  const removed = prev.filter((descriptor) => !nextNames.has(descriptor.name))
  return { added, changed, removed, unchanged }
}

/** Plugin event subscription key `package:event`. */
export function pluginEventKeyOf(type: string | null | undefined): string | null {
  if (typeof type !== "string" || !type.startsWith("plugin:")) return null
  const rest = type.slice("plugin:".length)
  const separator = rest.indexOf(":")
  if (separator <= 0 || separator >= rest.length - 1) return null
  const packageName = rest.slice(0, separator)
  const eventName = rest.slice(separator + 1)
  if (!packageName || !eventName) return null
  return `${packageName}:${eventName}`
}

/** Accepts either `package:event` or the full `plugin:package:event` type. */
export function normalizePluginEventKey(key: string | null | undefined): string | null {
  if (typeof key !== "string" || key.length === 0) return null
  if (key.startsWith("plugin:")) return pluginEventKeyOf(key)
  const separator = key.indexOf(":")
  if (separator <= 0 || separator >= key.length - 1) return null
  return `${key.slice(0, separator)}:${key.slice(separator + 1)}`
}

// ---------------------------------------------------------------------------
// Snapshot ingestion
// ---------------------------------------------------------------------------

/**
 * Apply one committed client snapshot.
 *
 * Returns false when the snapshot is malformed, targeted at a different boot or
 * older than the current generation (stale response). Invalid descriptors never
 * replace a previously accepted descriptor — the old object stays active and an
 * error diagnostic is recorded (spec §10.4).
 */
export function applyPluginClientSnapshot(
  snapshot: PluginClientSnapshot | null | undefined,
  bootId?: string,
): boolean {
  const raw = snapshot as unknown as Record<string, unknown> | null | undefined
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) {
    addNotice({
      level: "error",
      message: "invalid plugin client snapshot",
      code: "snapshot-invalid",
      source: "transport",
    })
    return false
  }

  const nextGeneration = parsePluginRevision(raw.revision)
  if (!nextGeneration) {
    addNotice({
      level: "error",
      message: "plugin client snapshot is missing a revision",
      code: "snapshot-invalid",
      source: "transport",
    })
    return false
  }

  if (typeof bootId === "string" && bootId.length > 0 && bootId !== nextGeneration.bootId) {
    addNotice({
      level: "info",
      message: `discarded plugin snapshot for stale boot ${nextGeneration.bootId}`,
      code: "snapshot-stale-boot",
      revision: nextGeneration.revision,
      source: "transport",
    })
    return false
  }

  const current = state()
  if (current.generation && !isNewerPluginGeneration(nextGeneration, current.generation)) {
    return false
  }

  const byName: Record<string, PluginClientDescriptor> = {}
  const order: string[] = []
  for (const candidate of raw.plugins as unknown[]) {
    const descriptor = validatePluginDescriptor(candidate)
    if (!descriptor) {
      const name = isRecord(candidate) && typeof candidate.name === "string" ? candidate.name : undefined
      addNotice({
        level: "error",
        message: `plugin descriptor rejected${name ? ` for ${name}` : ""}`,
        code: "descriptor-invalid",
        package: name,
        revision: nextGeneration.revision,
        source: "transport",
      })
      // Keep the last accepted descriptor until a valid replacement arrives.
      const kept = name ? current.byName[name] : undefined
      if (kept) pushDescriptor(byName, order, kept)
      continue
    }
    const before = current.byName[descriptor.name]
    pushDescriptor(
      byName,
      order,
      before && samePluginDescriptor(before, descriptor) ? before : descriptor,
    )
  }

  setState({ generation: nextGeneration, byName, order })
  replaceDescriptorNotices(order.map((name) => byName[name]))
  return true
}

/** Hub inventory → pending revision map (advisory; pending never bumps client revision). */
export function applyPluginInventory(inventory: PluginsListResult | null | undefined): void {
  const raw = inventory as unknown as Record<string, unknown> | null | undefined
  const rows = isRecord(raw) ? raw.packages : undefined
  if (!Array.isArray(rows)) return
  const next: Record<string, string> = {}
  for (const row of rows) {
    if (!isRecord(row)) continue
    if (typeof row.name !== "string" || row.name.length === 0) continue
    if (typeof row.pendingRevision === "string" && row.pendingRevision.length > 0) {
      next[row.name] = row.pendingRevision
    }
  }
  setPending(next)
}

/**
 * Fetch the committed snapshot (and advisory inventory).
 *
 * Concurrent calls coalesce into one request; the sequence guard discards a
 * response when a newer refresh started meanwhile. Fetch failures keep the last
 * good state (fail-open) and record a diagnostic.
 */
export function refreshPluginClient(transport?: PluginClientTransport): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh
  const sequence = ++fetchSequence
  const active = transport ?? defaultPluginClientTransport()
  const run = (async (): Promise<boolean> => {
    try {
      let snapshot: PluginClientSnapshot
      try {
        snapshot = await active.fetchClient()
      } catch (err) {
        if (sequence === fetchSequence) {
          addNotice({
            level: "error",
            message: `plugin client refresh failed: ${messageOf(err)}`,
            code: "fetch-failed",
            source: "transport",
          })
        }
        return false
      }
      if (sequence !== fetchSequence) return false
      const applied = applyPluginClientSnapshot(snapshot)
      if (active.fetchInventory) {
        try {
          const inventory = await active.fetchInventory()
          if (sequence === fetchSequence) applyPluginInventory(inventory)
        } catch {
          // Inventory is advisory (pending apply only); never block descriptors.
        }
      }
      return applied
    } catch (err) {
      // Defensive: refresh is called fire-and-forget from SSE wiring, so it
      // must never reject into an unhandled promise.
      if (sequence === fetchSequence) {
        addNotice({
          level: "error",
          message: `plugin client refresh failed: ${messageOf(err)}`,
          code: "fetch-failed",
          source: "transport",
        })
      }
      return false
    }
  })()
  inflightRefresh = run.finally(() => {
    if (fetchSequence === sequence) inflightRefresh = null
  })
  return inflightRefresh
}

/**
 * `plugins.changed` handler: refresh once per unseen revision.
 *
 * Duplicate notifications coalesce with the in-flight refresh; stale (older)
 * revisions never trigger a fetch. When the coalesced response predates the
 * committed revision, one follow-up fetch is issued.
 */
export async function ingestPluginsChanged(
  event: unknown,
  transport?: PluginClientTransport,
): Promise<boolean> {
  const revision = pluginsChangedRevision(event)
  const parsed = parsePluginRevision(revision)
  const current = state().generation
  if (parsed && current) {
    if (parsed.revision === current.revision) return false
    if (!isNewerPluginGeneration(parsed, current)) return false
  }
  const applied = await refreshPluginClient(transport)
  if (!parsed) return applied
  const after = state().generation
  if (after && !isNewerPluginGeneration(parsed, after)) {
    return applied || after.revision === parsed.revision
  }
  // The coalesced request may have been issued before this commit landed.
  const followUp = await refreshPluginClient(transport)
  return applied || followUp
}

// ---------------------------------------------------------------------------
// Package event router
// ---------------------------------------------------------------------------

export interface PluginEventNotice {
  type: string
  package: string
  event: string
  properties: unknown
  sessionID?: string
}

/**
 * Subscribe to `package:event` (or the full `plugin:package:event` type).
 * Returns an unsubscribe function. Callbacks receive neutral data only.
 */
export function subscribePluginEvent(
  key: string,
  callback: (event: PluginEventNotice) => void,
): () => void {
  const normalized = normalizePluginEventKey(key)
  if (!normalized) return () => {}
  let bucket = subscribers.get(normalized)
  if (!bucket) {
    bucket = new Set()
    subscribers.set(normalized, bucket)
  }
  bucket.add(callback)
  return () => {
    const current = subscribers.get(normalized)
    if (!current) return
    current.delete(callback)
    if (current.size === 0) subscribers.delete(normalized)
  }
}

/**
 * Route one `plugin:<package>:<event>` frame.
 *
 * Only packages that are committed *and* declared the event receive it. Unknown
 * packages/events become diagnostics instead of crashing or being silently
 * dropped by class; plugin code is never executed here.
 */
export function ingestPluginEvent(event: unknown): boolean {
  const raw = event as Record<string, unknown> | null | undefined
  const type = isRecord(raw) && typeof raw.type === "string" ? raw.type : ""
  if (!type.startsWith("plugin:")) return false
  const key = pluginEventKeyOf(type)
  if (!key) {
    addRouterNotice({
      level: "warning",
      message: `malformed plugin event type: ${type}`,
      code: "event-malformed",
      package: type.slice("plugin:".length) || undefined,
    })
    return false
  }
  const separator = key.indexOf(":")
  const packageName = key.slice(0, separator)
  const eventName = key.slice(separator + 1)
  const descriptor = pluginDescriptorFor(packageName)
  if (!descriptor) {
    if (!state().generation) {
      // Boot race: the SSE frame may beat the first client snapshot fetch.
      // Panels fetch their view on mount anyway; report once per package as
      // info instead of a false "unknown package" warning.
      addRouterNotice({
        level: "info",
        message: `plugin event before client snapshot: ${type}`,
        code: "event-before-snapshot",
        package: packageName,
      })
      return false
    }
    addRouterNotice({
      level: "warning",
      message: `plugin event from unknown package: ${type}`,
      code: "event-unknown-package",
      package: packageName,
    })
    return false
  }
  const declared = (descriptor.events ?? []).some((entry) => entry && entry.type === type)
  if (!declared) {
    addRouterNotice({
      level: "warning",
      message: `plugin event not registered by package: ${type}`,
      code: "event-unregistered",
      package: packageName,
    })
    return false
  }
  const notice: PluginEventNotice = {
    type,
    package: packageName,
    event: eventName,
    properties: isRecord(raw) ? raw.properties : undefined,
    sessionID: isRecord(raw) && typeof raw.sessionID === "string" ? raw.sessionID : undefined,
  }
  const bucket = subscribers.get(key)
  if (bucket) {
    for (const callback of [...bucket]) {
      try {
        callback(notice)
      } catch (err) {
        addRouterNotice({
          level: "warning",
          message: `plugin event subscriber failed: ${messageOf(err)}`,
          code: "event-subscriber-failed",
          package: packageName,
        })
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function pushDescriptor(
  byName: Record<string, PluginClientDescriptor>,
  order: string[],
  descriptor: PluginClientDescriptor,
): void {
  if (!(descriptor.name in byName)) order.push(descriptor.name)
  byName[descriptor.name] = descriptor
}

function pluginsChangedRevision(event: unknown): string | undefined {
  const raw = event as Record<string, unknown> | null | undefined
  if (!isRecord(raw)) return undefined
  const properties = isRecord(raw.properties) ? raw.properties : undefined
  const candidate = properties?.revision ?? raw.revision
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
}

function validatePluginDescriptor(value: unknown): PluginClientDescriptor | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== "string" || value.name.length === 0) return null
  if (typeof value.revision !== "string" || value.revision.length === 0) return null
  if (!isRecord(value.ui)) return null
  if (!Array.isArray(value.actions) || !Array.isArray(value.events)) return null
  return value as unknown as PluginClientDescriptor
}

function replaceDescriptorNotices(descriptors: PluginClientDescriptor[]): void {
  const projected: PluginDiagnosticNotice[] = []
  for (const descriptor of descriptors) {
    for (const diagnostic of descriptor.diagnostics ?? []) {
      if (!diagnostic || typeof diagnostic.message !== "string") continue
      projected.push({
        level: diagnostic.level === "error" || diagnostic.level === "info" ? diagnostic.level : "warning",
        message: diagnostic.message,
        code: diagnostic.code || "descriptor",
        package: descriptor.name,
        revision: descriptor.revision,
        source: "descriptor",
      })
    }
  }
  setNotices((prev) => [...prev.filter((notice) => notice.source !== "descriptor"), ...projected].slice(-MAX_DIAGNOSTICS))
}

function addNotice(notice: PluginDiagnosticNotice): void {
  setNotices((prev) => [...prev, notice].slice(-MAX_DIAGNOSTICS))
}

/** Router diagnostics dedupe by code+package so a misbehaving plugin cannot flood. */
function addRouterNotice(notice: Omit<PluginDiagnosticNotice, "source">): void {
  const key = `${notice.code}|${notice.package ?? ""}`
  if (seenRouterNotices.has(key)) return
  seenRouterNotices.add(key)
  addNotice({ ...notice, source: "router" })
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
    }
    return true
  }
  return false
}

/** Test/dev reset: clears signals, subscriptions and in-flight bookkeeping. */
export function resetPluginStore(): void {
  fetchSequence += 1
  inflightRefresh = null
  setState({ generation: null, byName: {}, order: [] })
  setPending({})
  setNotices([])
  subscribers.clear()
  seenRouterNotices.clear()
}
