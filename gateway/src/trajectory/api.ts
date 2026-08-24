import { TrajectoryStore } from './trajectory-store';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts } from './types';

export interface TrajectoryRequestContext {
  store: TrajectoryStore;
  sessionID: string;
  opts: { limit: number; beforeTurn?: number; rebuild?: boolean };
  messages?: any;
  projectID?: string;
}

export async function handleTrajectoryRequest(
  ctx: TrajectoryRequestContext,
): Promise<{ turns: TrajectoryTurn[]; events: TrajectoryEvent[] }> {
  const { store, sessionID, opts } = ctx;
  const result = store.getSessionTrajectory(sessionID, { limit: opts.limit, beforeTurn: opts.beforeTurn });
  if (opts.rebuild && result.turns.length === 0 && result.events.length === 0 && ctx.messages) {
    const messages = Array.isArray(ctx.messages?.data) ? ctx.messages.data : Array.isArray(ctx.messages) ? ctx.messages : [];
    if (messages.length > 0) {
      return rebuildFromMessages(store, sessionID, messages, ctx.projectID || '/proj');
    }
  }
  return result;
}

function rebuildFromMessages(
  store: TrajectoryStore,
  sessionID: string,
  messages: any[],
  projectID: string,
): { turns: TrajectoryTurn[]; events: TrajectoryEvent[] } {
  const turns: TrajectoryTurn[] = [];
  const events: TrajectoryEvent[] = [];
  let seq = 0;

  const userMessages = messages.filter((m: any) => m?.info?.role === 'user' || m?.role === 'user');
  if (userMessages.length === 0) return { turns: [], events: [] };

  for (let idx = 0; idx < userMessages.length; idx++) {
    const um = userMessages[idx];
    const info = um.info || um;
    const turnID = idx + 1;
    const startMs = info?.time?.created || Date.now();
    const agent = info?.agent || null;
    const baseModel = info?.model?.modelID || null;

    events.push({
      projectID,
      sessionID,
      turnID,
      seq: ++seq,
      eventType: 'turn_start',
      timeMs: startMs,
    } as TrajectoryEvent);

    const parentID = info.id || um.id;
    const assistantMessages = messages.filter(
      (m: any) => (m?.info?.role === 'assistant' && m?.info?.parentID === parentID) || (m?.role === 'assistant' && m?.parentID === parentID),
    );
    let toolCount = 0;
    let toolErrorCount = 0;
    let reasoningCount = 0;
    const tokens: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let cost = 0;
    let finish: string | null = null;
    let model: string | null = null;
    let endMs: number | null = null;
    let userText = '';

    // user text
    const userPart = (um.parts || um?.info?.parts || []).find((p: any) => p.type === 'text' && typeof p.text === 'string');
    if (userPart) userText = String(userPart.text).slice(0, 300);
    if (!userText && info?.summary?.body) userText = String(info.summary.body).slice(0, 300);

    for (const am of assistantMessages) {
      const ai = am.info || am;
      const parts = (am.parts || ai?.parts || []) as any[];
      model = ai?.modelID || model;
      if (ai?.tokens) {
        tokens.input += ai.tokens.input || 0;
        tokens.output += ai.tokens.output || 0;
        tokens.reasoning += ai.tokens.reasoning || 0;
        tokens.cache.read += ai.tokens.cache?.read || 0;
        tokens.cache.write += ai.tokens.cache?.write || 0;
        cost += ai.cost || 0;
        if (ai.finish) finish = ai.finish;
      }
      if (ai?.time?.completed) endMs = ai.time.completed;

      for (const p of parts) {
        if (p?.type === 'tool' && p.state) {
          events.push({
            projectID,
            sessionID,
            turnID,
            seq: ++seq,
            eventType: 'tool_start',
            toolName: p.tool,
            callID: p.callID,
            timeMs: p.state?.time?.start || startMs,
          } as TrajectoryEvent);
          if (p.state.status === 'completed' || p.state.status === 'error') {
            toolCount++;
            if (p.state.status === 'error') toolErrorCount++;
            events.push({
              projectID,
              sessionID,
              turnID,
              seq: ++seq,
              eventType: 'tool_end',
              toolName: p.tool,
              callID: p.callID,
              toolState: p.state.status,
              outputSummary: truncate(p.state.output || p.state.error, 500),
              error: p.state.status === 'error' ? truncate(p.state.error, 500) : undefined,
              durationMs: p.state.time ? p.state.time.end - p.state.time.start : undefined,
              timeMs: p.state.time?.end || startMs,
            } as TrajectoryEvent);
          }
        } else if (p?.type === 'reasoning') {
          reasoningCount++;
          events.push({ projectID, sessionID, turnID, seq: ++seq, eventType: 'reasoning_start', timeMs: p.time?.start || startMs } as TrajectoryEvent);
          if (p.time?.end) {
            events.push({
              projectID,
              sessionID,
              turnID,
              seq: ++seq,
              eventType: 'reasoning_end',
              durationMs: p.time.end - (p.time.start || p.time.end),
              timeMs: p.time.end,
            } as TrajectoryEvent);
          }
        }
      }
    }

    turns.push({
      projectID,
      sessionID,
      turnID,
      turnStartMs: startMs,
      turnEndMs: endMs,
      durationMs: endMs ? endMs - startMs : null,
      toolCount,
      toolErrorCount,
      reasoningCount,
      agentSwitchCount: 0,
      tokens,
      cost,
      finish: finish || 'unknown',
      model: model || baseModel,
      provider: null,
      agent,
      userText,
    });
  }

  if (turns.length > 0) {
    // Reset seq per turn so store order is stable
    for (const t of turns) store.upsertTurn(t);
    let nextSeq = 1;
    for (const e of events) {
      store.recordEvent({ ...e, seq: nextSeq++ } as TrajectoryEvent);
    }
  }
  return { turns: turns.sort((a, b) => b.turnID - a.turnID), events };
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '\u2026' : s;
}
