/**
 * opencode canonical envelope → `AdapterEvent` v1 emitter.
 *
 * Phase 4 / W1 decision (see `.superpowers/sdd/2026-11-10-adapters-opencode-phase4/context.md`
 * ruling 1): the dialect tables stay raw → canonical inside the adapter; this
 * module is the adapter-local canonical → `AdapterEvent` tail. `translateNative`
 * composes it with `applyEventMappings` + `validateAdapterEvent`, so
 * `transport.onEvent` can yield only validated `AdapterEvent`s and the gateway
 * never sees a native envelope or canonical intermediate from this driver.
 *
 * The switch was lifted from the legacy bridge (Plan 6); the adapter copy is now
 * the only emitter and is pinned by the native golden (type + `data`).
 *
 * Turn identity is not minted here; `OpencodeTurnAttribution` owns the queue and
 * the stable fallback ids (`opencode_turn_*`). This module only forwards a
 * canonical `properties.turnID` when the dialect provided one.
 */
import { RUNTIME_IDENTITY_TYPES, validateAdapterEvent, type AdapterEvent } from '@mafw/runtime-contract';
import { applyEventMappings } from '@mafw/runtime-core';
import type { EventMappingEntry, RawRuntimeEvent, TranslationHooks } from '@mafw/runtime-core';
import type { OpencodeTurnAttribution } from './turn-attribution';

/** Canonical vocabulary the dialect tables are allowed to produce. */
export const OPENCODE_CANONICAL_TYPES: ReadonlySet<string> = new Set(RUNTIME_IDENTITY_TYPES);

/** Native types whose transform intentionally suppresses the frame. */
const TRANSFORM_SUPPRESSED: ReadonlySet<string> = new Set(['session.next.synthetic']);

/** Native types a dialect entry explicitly declares (mapping rows, incl. drops). */
const declaredTypes = new WeakMap<EventMappingEntry, ReadonlySet<string>>();
function declaredTypesOf(entry: EventMappingEntry): ReadonlySet<string> {
  const cached = declaredTypes.get(entry);
  if (cached) return cached;
  const declared = new Set<string>();
  for (const row of entry.eventMappings ?? []) {
    for (const from of Array.isArray(row.from) ? row.from : [row.from]) declared.add(from);
  }
  declaredTypes.set(entry, declared);
  return declared;
}

let sequence = 0;

/**
 * Stable, unique event id. The module counter survives reconnects, so a
 * resubscribed stream can never reuse an id the bus has already seen (the bus
 * drops duplicates by `event.id` only).
 */
export function nextOpencodeEventID(): string {
  sequence += 1;
  return `opencode_evt_${Date.now().toString(36)}_${sequence}`;
}

export interface EmitContext {
  /** Canonical `properties.turnID`, when the dialect supplied one. */
  turnID?: string;
  /** Epoch milliseconds (tests may pin it). */
  at?: number;
}

function propsOf(evt: RawRuntimeEvent): Record<string, any> {
  return (evt.payload?.properties ?? evt.properties ?? {}) as Record<string, any>;
}

function typeOf(evt: RawRuntimeEvent): string {
  return String(evt.payload?.type ?? evt.type ?? '');
}

function sessionOf(evt: RawRuntimeEvent, props: Record<string, any>): string | undefined {
  return props.sessionID
    ?? props.part?.sessionID
    ?? props.message?.sessionID
    ?? props.info?.sessionID
    ?? props.info?.id
    ?? evt.sessionID;
}

/**
 * Reverse-map a canonical envelope to one `AdapterEvent`.
 *
 * Returns `null` for canonical types this driver has no AdapterEvent home for
 * (the caller reports them as unmatched/dropped). Validation is the caller's
 * job (`translateNative`), so a single bad payload never stops fan-out.
 */
export function toAdapterEvent(evt: RawRuntimeEvent, ctx: EmitContext = {}): AdapterEvent | null {
  const type = typeOf(evt);
  const props = propsOf(evt);
  const sessionID = sessionOf(evt, props);
  if (!type) return null;
  const turnID = ctx.turnID ?? (typeof props.turnID === 'string' ? props.turnID : undefined);
  const base = {
    id: nextOpencodeEventID(),
    sessionID,
    turnID,
    // Canonical permission/question rows carry `requestId` (v2.1 mapping) or the
    // request id inline (`id`). v1/v2 replies carry the native uppercase
    // `requestID`; preserve all three so the native path never drops a real
    // approval reply.
    requestID: typeof props.requestId === 'string'
      ? props.requestId
      : typeof props.requestID === 'string'
        ? props.requestID
        : typeof props.id === 'string' ? props.id : undefined,
    at: ctx.at ?? Date.now(),
  };
  const make = (t: AdapterEvent['type'], data: unknown): AdapterEvent => ({ ...base, type: t, data } as AdapterEvent);

  switch (type) {
    case 'session.created': {
      const info = props.info && typeof props.info === 'object' ? props.info : props;
      const id = info.id ?? props.sessionID;
      return make('session.created', { session: { ...info, ...(id ? { id } : {}) } });
    }
    case 'session.updated': return make('session.updated', { patch: props.info });
    case 'session.deleted': return make('session.deleted', {});
    case 'session.compacting': return make('session.compacting', {});
    case 'session.compacted': return make('session.compacted', {});
    case 'turn.started': return make('turn.started', {});
    case 'turn.completed': return make('turn.completed', { ok: props.ok !== false, stopReason: props.stopReason, usage: props.usage, costUsd: props.cost });
    case 'turn.failed': return make('turn.failed', {
      error: { kind: 'unknown', message: String(props.error?.message ?? props.error ?? 'runtime error') },
      retryable: props.retryable,
    });
    case 'turn.aborted': return make('turn.aborted', { reason: props.reason });
    case 'turn.retrying': return make('turn.retrying', { attempt: props.attempt, delayMs: props.delayMs, reason: props.reason });
    case 'turn.waiting': return make('turn.waiting', { reason: props.reason });
    case 'turn.cap_exhausted': return make('turn.cap_exhausted', { reason: props.reason });
    case 'message.updated': return make('message.updated', { message: props.message });
    case 'message.removed': return make('message.removed', { messageID: props.messageID ?? props.message?.id });
    case 'part.updated': return make('part.updated', { part: props.part });
    case 'part.delta': return make('part.delta', { messageID: props.messageID, partID: props.partID, field: props.field, delta: props.delta });
    case 'part.complete': return make('part.completed', { part: props.part });
    case 'part.removed': return make('part.removed', { partID: props.partID ?? props.part?.id });
    case 'permission.asked': return make('permission.asked', { request: props });
    case 'permission.replied': return make('permission.replied', { reply: props.reply ?? (props.approved ? 'once' : 'reject'), source: props.source ?? 'user', message: props.message });
    case 'question.asked': return make('question.asked', { request: props });
    case 'question.replied': return make('question.replied', { answers: props.answers });
    case 'question.rejected': return make('question.rejected', {});
    case 'plan.updated': return make('plan.updated', { items: props.todos ?? props.items ?? props });
    case 'usage.updated': return make('usage.updated', { usage: props.usage ?? props, contextTokens: props.contextTokens, contextWindow: props.contextWindow });
    case 'background.job.updated': return make('background.job.updated', { job: props.job });
    // 2.1 inbox events carry `action`/`item`/`id` but no snapshot, so `items` must
    // stay absent to avoid clearing the client queue.
    case 'queue.updated': return make('queue.updated', {
      ...(Array.isArray(props.items) ? { items: props.items } : {}),
      ...(props.action ? { action: props.action } : {}),
      ...(props.item ? { item: props.item } : {}),
      ...(props.id ? { id: props.id } : {}),
    });
    case 'session.diff': return make('session.diff', { messageID: props.messageID, diff: props.diff ?? [] });
    case 'tool.call': return make('tool.call', { callID: props.callID, name: props.tool ?? props.name, input: props.input ?? {}, title: props.title });
    case 'tool.delta': return make('tool.delta', { callID: props.callID, field: props.kind ?? props.field, delta: props.text ?? props.delta });
    case 'tool.result': return make('tool.result', {
      callID: props.callID,
      ok: props.isError !== true,
      output: props.output,
      ...(props.error ? { error: props.error } : {}),
    });
    case 'runtime.notice': return make('runtime.notice', { level: props.level ?? 'info', message: props.message ?? '' });
    default: return null;
  }
}

/**
 * native raw event(s) → validated `AdapterEvent[]`.
 *
 * One call may yield zero (suppressed/unmatched/invalid), one, or N events
 * (v2.1 terminal fan-out). Suppression counters stay owned by
 * `applyEventMappings`; a canonical type with no AdapterEvent home is reported
 * through `onUnmatched` and dropped, never emitted as a guess.
 */
export function translateNative(
  raw: any,
  entry: EventMappingEntry,
  hooks: TranslationHooks | undefined,
  attribution: OpencodeTurnAttribution,
): AdapterEvent[] {
  // `applyEventMappings` reports `transformEvent` → undefined as *suppressed*.
  // For an undeclared native type that is the table's catch-all, not an author
  // drop row: report it as unmatched so vocabulary drift stays visible.
  const declared = declaredTypesOf(entry);
  const routedHooks: TranslationHooks | undefined = hooks
    ? {
        ...hooks,
        onSuppressed: (type) => {
          if (declared.has(type) || TRANSFORM_SUPPRESSED.has(type)) hooks.onSuppressed?.(type);
          else hooks.onUnmatched?.(type);
        },
      }
    : undefined;

  const canonicalEvents = applyEventMappings(raw, entry, (type) => OPENCODE_CANONICAL_TYPES.has(type), routedHooks);
  const emitted: AdapterEvent[] = [];
  // A 1→N fan-out belongs to one turn. The first attributed event fixes the id
  // for the rest of the batch, so a terminal + its anchor message cannot inherit
  // the next queued turn's id.
  let batchTurnID: string | undefined;

  for (const canonical of canonicalEvents) {
    const event = toAdapterEvent(canonical, batchTurnID ? { turnID: batchTurnID } : {});
    if (!event) {
      const type = typeOf(canonical);
      if (type) hooks?.onUnmatched?.(type);
      continue;
    }
    const attributed = attribution.attribute(event);
    if (!attributed) continue;
    if (!batchTurnID && attributed.turnID) batchTurnID = attributed.turnID;
    const validation = validateAdapterEvent(attributed);
    if (!validation.ok) {
      hooks?.onTranslationError?.(attributed, validation.errors.join('; '));
      continue;
    }
    emitted.push(validation.event);
  }

  return emitted;
}
