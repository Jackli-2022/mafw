/**
 * Native opencode transport (Phase 4 W2).
 *
 * Delegates the session/serve calls to the extracted adapter client while
 * owning the neutral seam: `onEvent` subscribes to the native stream, resolves
 * the dialect entry, translates through `translateNative` and emits only
 * validated `AdapterEvent`s. No legacy bridge, no canonical frame leaves this
 * module.
 *
 * Phase 4 W5 will add reconnect/backoff and a re-probe on stream teardown;
 * `rewire()` already resets the resolved entry + buffer for that path.
 */
import type {
  AdapterEvent,
  ApprovalDecision,
  RequestOutcome,
  RuntimeTransport,
  SendTurnInput,
  SteerOutcome,
} from '@mafw/runtime-contract';
import type { EventMappingEntry, RawRuntimeEvent, TranslationHooks } from '@mafw/runtime-core';
import { translateNative } from './emit';
import { OpencodeTurnAttribution } from './turn-attribution';
import type { OpencodeRuntime } from './types';

export interface OpencodeTransportOptions {
  /** Static entry for pinned variants (or the adaptive fallback). */
  entry: EventMappingEntry;
  /** Adaptive resolver: probes once, then the transport keeps the entry. */
  resolveEntry?: () => Promise<EventMappingEntry>;
  hooks?: TranslationHooks;
  onEntryResolved?: (entry: EventMappingEntry) => void;
  warn?: (message: string) => void;
}

export interface OpencodeTransport extends RuntimeTransport {
  /** Re-arm dialect resolution (serve recovery); W5 wires the resubscribe. */
  rewire?(): void;
}

const MAX_PRE_RESOLVE_BUFFER = 512;

export function createOpencodeTransport(
  runtime: OpencodeRuntime,
  opts: OpencodeTransportOptions,
): OpencodeTransport {
  const attribution = new OpencodeTurnAttribution();
  const listeners = new Set<(event: AdapterEvent) => void>();
  const unsubscribers = new Set<() => void>();
  let entry: EventMappingEntry | undefined = opts.resolveEntry ? undefined : opts.entry;
  let resolving: Promise<EventMappingEntry> | undefined;
  let buffered: RawRuntimeEvent[] = [];
  let closed = false;

  const emitFailure = (sessionID: string, turnID: string, message: string) => {
    const event = {
      id: `opencode_fail_${Date.now().toString(36)}`,
      type: 'turn.failed',
      sessionID,
      turnID,
      at: Date.now(),
      data: { error: { kind: 'unknown', message }, retryable: false },
    } as AdapterEvent;
    for (const listener of listeners) listener(event);
  };

  const dispatch = (raw: RawRuntimeEvent) => {
    if (closed || !entry) return;
    for (const event of translateNative(raw, entry, opts.hooks, attribution)) {
      for (const listener of listeners) listener(event);
    }
  };

  const flush = () => {
    if (!entry) return;
    const pending = buffered;
    buffered = [];
    for (const raw of pending) dispatch(raw);
  };

  const resolve = () => {
    if (entry || resolving || !opts.resolveEntry) return;
    resolving = opts.resolveEntry()
      .then((resolved) => {
        entry = resolved;
        opts.onEntryResolved?.(resolved);
        flush();
        return resolved;
      })
      .catch(() => {
        // Fail-safe: keep the static entry and re-arm for the next frame.
        entry = opts.entry;
        resolving = undefined;
        opts.warn?.('[opencode] dialect probe failed; falling back to the static entry');
        flush();
        return opts.entry;
      });
  };

  const receive = (raw: RawRuntimeEvent) => {
    if (closed) return;
    if (entry) {
      dispatch(raw);
      return;
    }
    if (buffered.length >= MAX_PRE_RESOLVE_BUFFER) buffered.shift();
    buffered.push(raw);
    resolve();
  };

  let subscriptionGeneration = 0;
  let reconnectDelay = 250;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let legacySubscribed = false;

  const subscribeLoop = async () => {
    const generation = ++subscriptionGeneration;
    const cancelled = () => closed || generation !== subscriptionGeneration || listeners.size === 0;
    while (!cancelled()) {
      try {
        const connection = await runtime.global.event();
        const stream = connection?.stream;
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
          throw new Error('event stream unavailable');
        }
        for await (const raw of stream) {
          if (cancelled()) return;
          receive(raw);
        }
        reconnectDelay = 250;
      } catch {
        // stream teardown / serve restart: retry below.
      }
      if (cancelled()) return;
      // A reconnect may target a different serve dialect; re-arm the probe and
      // drop the pre-probe buffer so stale frames cannot be translated later.
      transport.rewire?.();
      await new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(resolve, reconnectDelay);
        reconnectTimer.unref?.();
      });
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
    }
  };

  const transport: OpencodeTransport = {
    async createSession(input) {
      const created = await runtime.session.create({ directory: input.directory, parentID: input.parentID });
      return { sessionID: String((created as any)?.id ?? (created as any)?.sessionID) };
    },
    async sendTurn(input: SendTurnInput) {
      attribution.enqueue(input.sessionID, input.turnID);
      void Promise.resolve(runtime.session.promptAsync({
        sessionID: input.sessionID,
        message: input.text,
        parts: input.parts,
        system: input.system,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        thinkingLevel: input.thinkingLevel,
        delivery: input.delivery,
        expectReply: input.expectReply,
        idempotencyKey: input.idempotencyKey,
      } as any)).catch((err: any) => {
        attribution.withdraw(input.sessionID, input.turnID);
        emitFailure(input.sessionID, input.turnID, String(err?.message ?? err));
      });
      return { turnID: input.turnID };
    },
    async interruptTurn(sessionID) {
      attribution.abort(sessionID);
      await runtime.session.abort({ sessionID });
    },
    async respondToRequest(sessionID: string, requestID: string, decision: ApprovalDecision): Promise<RequestOutcome> {
      if (typeof runtime.session.permissionReply !== 'function') return 'unavailable';
      const reply = decision.behavior === 'answer'
        ? 'once'
        : decision.behavior === 'allow' ? (decision.always ? 'always' : 'once') : 'reject';
      await runtime.session.permissionReply(sessionID, requestID, reply, decision.message);
      return decision.behavior === 'answer' ? 'answered' : decision.behavior === 'allow' ? 'allowed-once' : 'rejected';
    },
    async steer(sessionID: string, text: string): Promise<SteerOutcome> {
      try {
        await runtime.session.promptAsync({ sessionID, message: text, delivery: 'steer', expectReply: false } as any);
        return 'steered';
      } catch {
        return 'indeterminate';
      }
    },
    async stop() {
      closed = true;
      subscriptionGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.clear();
      await (runtime as any).dispose?.();
    },
    onEvent(listener) {
      listeners.add(listener);
      if (!legacySubscribed) {
        const legacyOnEvent = (runtime as any).onEvent;
        if (typeof legacyOnEvent === 'function') {
          unsubscribers.add(legacyOnEvent(receive));
        }
        legacySubscribed = true;
      }
      if (listeners.size === 1) {
        void subscribeLoop();
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscriptionGeneration += 1;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          for (const unsubscribe of unsubscribers) unsubscribe();
          unsubscribers.clear();
          legacySubscribed = false;
        }
      };
    },
  };
  transport.rewire = () => {
    entry = opts.resolveEntry ? undefined : opts.entry;
    resolving = undefined;
    buffered = [];
  };
  return transport;
}
