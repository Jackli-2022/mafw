import type { RuntimeTransport, AdapterPartInput, SendTurnInput } from '@mafw/runtime-contract';
import { createClaudeRuntime, type ClaudeRuntimeDeps } from './runtime.ts';
import { claudeAdapterEvents } from './adapter-events.ts';

/** Wrap the legacy raw-event claude runtime in the neutral transport. */
export function createClaudeTransport(deps: ClaudeRuntimeDeps): RuntimeTransport {
  const runtime = createClaudeRuntime(deps);
  const turns = new Map<string, string>();
  let currentSession: string | undefined;

  return {
    async createSession(opts) {
      const created = await runtime.session.create({ directory: opts.directory });
      currentSession = String(created.id);
      return { sessionID: currentSession };
    },
    async sendTurn(input: SendTurnInput) {
      turns.set(input.sessionID, input.turnID);
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
          // The SDK reports its own session id; gateway owns the public id.
          const sid = currentSession ?? rawSid;
          const turnID = (sid ? turns.get(sid) : undefined) ?? (rawSid ? turns.get(rawSid) : undefined);
          for (const event of claudeAdapterEvents(raw, { sessionID: sid, turnID })) listener(event);
        }
      })().catch(() => { /* stream teardown is not an error */ });
      return () => { cancelled = true; };
    },
  };
}
