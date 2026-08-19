import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryStore } from './trajectory-store';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts, TrajectoryEventType } from './types';

const SUMMARY_MAX = 500;
const USER_TEXT_MAX = 300;

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '\u2026' : s;
}

interface TurnState {
  turnID: number;
  turnStartMs: number;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  agent: string | null;
  userText: string;
  userMessageID: string | null;
  stepFinishMessageIDs: Set<string>;
  toolCallIDs: Set<string>;
  reasoningPartIDs: Set<string>;
  lastModel: string | null;
}

export class TrajectoryCollector {
  private turns = new Map<string, TurnState>();
  private seqCounters = new Map<string, number>();

  constructor(
    private store: TrajectoryStore,
    private db: GatewayDatabase,
    private projectID: string,
  ) {}

  private seq(sessionID: string): number {
    const n = (this.seqCounters.get(sessionID) || 0) + 1;
    this.seqCounters.set(sessionID, n);
    return n;
  }

  private stateFor(sessionID: string, turnID?: number): TurnState {
    let s = this.turns.get(sessionID);
    if (!s) {
      s = {
        turnID: turnID ?? (this.db.currentTurnId(sessionID) || 1),
        turnStartMs: Date.now(),
        toolCount: 0,
        toolErrorCount: 0,
        reasoningCount: 0,
        agentSwitchCount: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        finish: null,
        model: null,
        agent: null,
        userText: '',
        userMessageID: null,
        stepFinishMessageIDs: new Set(),
        toolCallIDs: new Set(),
        reasoningPartIDs: new Set(),
        lastModel: null,
      };
      this.turns.set(sessionID, s);
    }
    return s;
  }

  private emit(sessionID: string, s: TurnState, eventType: TrajectoryEventType, extra: Partial<TrajectoryEvent> = {}): TrajectoryEvent {
    const evt: Omit<TrajectoryEvent, 'id'> = {
      projectID: this.projectID,
      sessionID,
      turnID: s.turnID,
      seq: this.seq(sessionID),
      eventType,
      timeMs: Date.now(),
      ...extra,
    };
    this.store.recordEvent(evt);
    this.store.pruneOlderThan(14);
    return evt as TrajectoryEvent;
  }

  handleEvent(type: string, props: any, directory?: string): TrajectoryEvent | null {
    const projectID = directory || this.projectID;
    if (projectID !== this.projectID && directory) return null;

    const sessionID = props?.info?.sessionID || props?.part?.sessionID || props?.sessionID;
    if (!sessionID) return null;

    if (type === 'message.updated') {
      const info = props?.info;
      if (!info) return null;
      if (info.role === 'user') {
        const s = this.stateFor(sessionID, this.db.nextTurnId(sessionID));
        s.turnStartMs = info?.time?.created || Date.now();
        s.turnID = this.db.nextTurnId(sessionID);
        s.userMessageID = info.id ?? null;
        s.userText = truncate(info?.summary?.body || '', USER_TEXT_MAX) || '';
        return this.emit(sessionID, s, 'turn_start');
      }
      if (info.role === 'assistant') {
        const s = this.stateFor(sessionID);
        if (info.modelID && s.lastModel && info.modelID !== s.lastModel) {
          s.agentSwitchCount++;
          const evt = this.emit(sessionID, s, 'model_switch', { model: info.modelID });
          s.lastModel = info.modelID;
          return evt;
        }
        s.lastModel = info.modelID || s.lastModel;
        s.model = info.modelID || s.model;
        if (!s.stepFinishMessageIDs.has(info.id) && info.finish && info.tokens) {
          s.stepFinishMessageIDs.add(info.id);
          s.tokens = addTokens(s.tokens, info.tokens);
          s.cost += info.cost || 0;
          s.finish = info.finish;
          const evt = this.emit(sessionID, s, 'step_finish', {
            model: info.modelID,
            tokens: info.tokens,
            cost: info.cost,
            finish: info.finish,
          });
          return evt;
        }
        return null;
      }
      return null;
    }

    if (type === 'message.part.updated') {
      const part = props?.part;
      if (!part) return null;
      const s = this.stateFor(sessionID);

      if (part.type === 'text' && part.text && s.userMessageID === part.messageID) {
        if (!s.userText) {
          s.userText = truncate(part.text, USER_TEXT_MAX) || '';
        }
        return null;
      }

      if (part.type === 'tool') {
        const st = part.state;
        if (!st) return null;
        if (st.status === 'running' || st.status === 'pending') {
          if (s.toolCallIDs.has(part.callID)) return null;
          s.toolCallIDs.add(part.callID);
          const evt = this.emit(sessionID, s, 'tool_start', {
            toolName: part.tool,
            callID: part.callID,
            inputSummary: truncate(summarizeInput(st.input), SUMMARY_MAX),
          });
          return evt;
        }
        if (st.status === 'completed' || st.status === 'error') {
          s.toolCount++;
          if (st.status === 'error') s.toolErrorCount++;
          const duration = st.time ? st.time.end - st.time.start : undefined;
          const evt = this.emit(sessionID, s, 'tool_end', {
            toolName: part.tool,
            callID: part.callID,
            toolState: st.status,
            outputSummary: truncate(st.output || st.error, SUMMARY_MAX),
            error: st.status === 'error' ? truncate(st.error, SUMMARY_MAX) : undefined,
            durationMs: duration,
          });
          return evt;
        }
        return null;
      }

      if (part.type === 'step-finish') {
        if (s.stepFinishMessageIDs.has(part.messageID)) return null;
        s.stepFinishMessageIDs.add(part.messageID);
        s.tokens = addTokens(s.tokens, part.tokens);
        s.cost += part.cost || 0;
        s.finish = part.reason;
        const evt = this.emit(sessionID, s, 'step_finish', {
          tokens: part.tokens,
          cost: part.cost,
          finish: part.reason,
        });
        return evt;
      }

      if (part.type === 'reasoning') {
        if (!s.reasoningPartIDs.has(part.id)) {
          s.reasoningPartIDs.add(part.id);
          s.reasoningCount++;
          const evt = this.emit(sessionID, s, 'reasoning_start');
          if (part.time?.end) {
            const end = this.emit(sessionID, s, 'reasoning_end', {
              durationMs: part.time.end - (part.time.start || part.time.end),
            });
            return end;
          }
          return evt;
        } else {
          const evt = this.emit(sessionID, s, 'reasoning_end', {
            durationMs: part.time?.end ? part.time.end - (part.time.start || part.time.end) : undefined,
          });
          return evt;
        }
      }

      return null;
    }

    return null;
  }

  onIdle(sessionID: string): TrajectoryTurn | null {
    const s = this.turns.get(sessionID);
    if (!s) return null;
    s.finish = s.finish || 'idle';
    const turn: TrajectoryTurn = {
      projectID: this.projectID,
      sessionID,
      turnID: s.turnID,
      turnStartMs: s.turnStartMs,
      turnEndMs: Date.now(),
      durationMs: Date.now() - s.turnStartMs,
      toolCount: s.toolCount,
      toolErrorCount: s.toolErrorCount,
      reasoningCount: s.reasoningCount,
      agentSwitchCount: s.agentSwitchCount,
      tokens: s.tokens,
      cost: s.cost,
      finish: s.finish,
      model: s.model,
      agent: s.agent,
      userText: s.userText,
    };
    this.store.upsertTurn(turn);
    this.emit(sessionID, s, 'turn_end');
    this.turns.delete(sessionID);
    return turn;
  }
}

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + (b.input || 0),
    output: a.output + (b.output || 0),
    reasoning: a.reasoning + (b.reasoning || 0),
    cache: { read: a.cache.read + (b.cache?.read || 0), write: a.cache.write + (b.cache?.write || 0) },
  };
}

function summarizeInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? s.slice(0, 200) + '\u2026' : s;
  } catch {
    return '';
  }
}
