import type { RuntimeTransport, AdapterPartInput, SendTurnInput } from '@mafw/runtime-contract';
import { createClaudeRuntime, type ClaudeRuntimeDeps } from './runtime.ts';
import { claudeAdapterEvents, type ClaudeDeltaState } from './adapter-events.ts';

/** Wrap the legacy raw-event claude runtime in the neutral transport. */
export function createClaudeTransport(deps: ClaudeRuntimeDeps): RuntimeTransport {
  const runtime = createClaudeRuntime(deps);
  const pendingTurns = new Map<string, string[]>();
  const activeTurns = new Map<string, string>();
  const rawToGateway = new Map<string, string>();
  const deltaStates = new Map<string, ClaudeDeltaState>();
  const unboundSessions: string[] = [];
  let fallbackSession: string | undefined;

  const bindRawSession = (rawSid: string | undefined, gatewaySid: string | undefined): string | undefined => {
    if (rawSid && rawToGateway.has(rawSid)) return rawToGateway.get(rawSid);
    if (rawSid && gatewaySid) {
      rawToGateway.set(rawSid, gatewaySid);
      const index = unboundSessions.indexOf(gatewaySid);
      if (index >= 0) unboundSessions.splice(index, 1);
      return gatewaySid;
    }
    if (rawSid && unboundSessions.length > 0) {
      const next = unboundSessions.shift()!;
      rawToGateway.set(rawSid, next);
      return next;
    }
    return gatewaySid ?? fallbackSession;
  };

  const isTurnStart = (raw: any): boolean =>
    raw?.payload?.type === 'turn.started' ||
    (raw?.type === 'user' && raw?.message?.role === 'user');

  return {
    async createSession(opts) {
      const created = await runtime.session.create({ directory: opts.directory });
      const sessionID = String(created.id);
      fallbackSession = sessionID;
      unboundSessions.push(sessionID);
      return { sessionID };
    },
    async sendTurn(input: SendTurnInput) {
      const queue = pendingTurns.get(input.sessionID) ?? [];
      queue.push(input.turnID);
      pendingTurns.set(input.sessionID, queue);
      const parts = (input.parts ?? [])
        .filter((part): part is Extract<AdapterPartInput, { type: 'text' }> => part.type === 'text')
        .map((part) => ({ type: 'text', text: part.text }));
      await runtime.session.promptAsync({
        sessionID: input.sessionID,
        message: input.text,
        parts: parts.length > 0 ? parts : undefined,
        system: input.system,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        thinkingLevel: input.thinkingLevel,
        expectReply: input.expectReply,
        idempotencyKey: input.idempotencyKey,
      } as any);
      return { turnID: input.turnID };
    },
    async interruptTurn(sessionID) {
      await runtime.session.abort({ sessionID });
      activeTurns.delete(sessionID);
    },
    async snapshot() {
      return { state: 'available' };
    },
    onEvent(listener) {
      let cancelled = false;
      void (async () => {
        const connection = await runtime.global.event();
        const stream = connection?.stream ?? connection;
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return;
        for await (const raw of stream) {
          if (cancelled) return;
          const rawSid = raw?.session_id ?? raw?.sessionID ?? raw?.payload?.properties?.sessionID;
          const sid = bindRawSession(rawSid, undefined);
          if (!sid) continue;
          if (isTurnStart(raw) && !activeTurns.has(sid)) {
            const queue = pendingTurns.get(sid) ?? [];
            const next = queue.shift();
            if (next) activeTurns.set(sid, next);
            if (queue.length === 0) pendingTurns.delete(sid);
          }
          const turnID = activeTurns.get(sid) ?? (pendingTurns.get(sid) ?? [])[0];
          const state = deltaStates.get(sid) ?? {};
          deltaStates.set(sid, state);
          const events = claudeAdapterEvents(raw, { sessionID: sid, turnID, state });
          for (const event of events) listener(event);
          if (events.some((event) => event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.aborted')) {
            activeTurns.delete(sid);
          }
        }
      })().catch(() => { /* stream teardown is not an error */ });
      return () => { cancelled = true; };
    },
  };
}
