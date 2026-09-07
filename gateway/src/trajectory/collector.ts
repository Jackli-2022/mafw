import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryStore } from './trajectory-store';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts, TrajectoryEventType } from './types';
import { log } from '../core/utils/logger';

const SUMMARY_MAX = 500;
const USER_TEXT_MAX = 300;

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + '\u2026' : s;
}

export function resolveRetentionDays(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 365;
  return Math.floor(v);
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
  provider: string | null;
  agent: string | null;
  userText: string;
  userMessageID: string | null;
  assistantText: string;
  assistantMessageID: string | null;
  stepFinishMessageIDs: Set<string>;
  toolCallIDs: Set<string>;
  reasoningPartIDs: Set<string>;
  lastModel: string | null;
  projectID: string;
}

export class TrajectoryCollector {
  private turns = new Map<string, TurnState>();
  private seqCounters = new Map<string, number>();
  private seenUserMessageIDs = new Set<string>();
  private opencodeClient: any;
  private _roleFor?: (sessionID: string) => string | null;

  constructor(
    private store: TrajectoryStore,
    private db: GatewayDatabase,
    private projectID: string,
    private getRetentionDays: () => number = () => 14,
  ) {}

  setOpencodeClient(client: any): void {
    this.opencodeClient = client;
  }

  setRoleFor(fn: (sessionID: string) => string | null): void {
    this._roleFor = fn;
  }

  private seq(sessionID: string): number {
    const n = (this.seqCounters.get(sessionID) || 0) + 1;
    this.seqCounters.set(sessionID, n);
    return n;
  }

  private stateFor(sessionID: string, turnID?: number, projectID?: string): TurnState {
    let s = this.turns.get(sessionID);
    if (!s) {
      s = {
        turnID: turnID ?? (this.store.currentTurnId(sessionID) || 1),
        turnStartMs: Date.now(),
        toolCount: 0,
        toolErrorCount: 0,
        reasoningCount: 0,
        agentSwitchCount: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        finish: null,
        model: null,
        provider: null,
        agent: null,
        userText: '',
        userMessageID: null,
        assistantText: '',
        assistantMessageID: null,
        stepFinishMessageIDs: new Set(),
        toolCallIDs: new Set(),
        reasoningPartIDs: new Set(),
        lastModel: null,
        projectID: projectID || this.projectID,
      };
      this.turns.set(sessionID, s);
    }
    return s;
  }

  private emit(sessionID: string, s: TurnState, eventType: TrajectoryEventType, extra: Partial<TrajectoryEvent> = {}, projectID?: string): TrajectoryEvent {
    const evt: Omit<TrajectoryEvent, 'id'> = {
      projectID: projectID || this.projectID,
      sessionID,
      turnID: s.turnID,
      seq: this.seq(sessionID),
      eventType,
      timeMs: Date.now(),
      ...extra,
    };
    this.store.recordEvent(evt);
    const days = resolveRetentionDays(this.getRetentionDays());
    if (days > 0) this.store.pruneOlderThan(days);
    return evt as TrajectoryEvent;
  }

  handleEvent(type: string, props: any, directory?: string): TrajectoryEvent | null {
    const projectID = directory || this.projectID;

    const sessionID = props?.info?.sessionID || props?.part?.sessionID || props?.sessionID;
    if (!sessionID) return null;

    if (type === 'message.updated') {
      const info = props?.info;
      if (!info) return null;
      log.info(`[Trajectory] message.updated: sessionID=${sessionID}, role=${info.role}, id=${info.id}, projectID=${projectID}`);
      if (info.role === 'user') {
        if (info.id && this.seenUserMessageIDs.has(info.id)) {
          log.info(`[Trajectory] user message duplicate: sessionID=${sessionID}, id=${info.id}, skipping`);
          return null;
        }
        if (info.id) this.seenUserMessageIDs.add(info.id);
        const nextId = this.store.nextTurnId(sessionID);
        const s = this.stateFor(sessionID, nextId, projectID);
        s.turnStartMs = info?.time?.created || Date.now();
        s.turnID = nextId;
        s.userMessageID = info.id ?? null;
        const summaryBody = info?.summary?.body || '';
        s.userText = truncate(summaryBody, USER_TEXT_MAX) || '';
        log.info(`[Trajectory] user message: sessionID=${sessionID}, id=${info.id}, summaryBody.len=${summaryBody.length}`);
        if (!s.userText && info.id && this.opencodeClient) {
          void this.fetchUserText(sessionID, info.id, s);
        }
        return this.emit(sessionID, s, 'turn_start', {}, projectID);
      }
      if (info.role === 'assistant') {
        const s = this.stateFor(sessionID, undefined, projectID);
        if (info.modelID && s.lastModel && info.modelID !== s.lastModel) {
          s.agentSwitchCount++;
          const evt = this.emit(sessionID, s, 'model_switch', { model: info.modelID }, projectID);
          s.lastModel = info.modelID;
          return evt;
        }
        s.lastModel = info.modelID || s.lastModel;
        s.model = info.modelID || s.model;
        s.provider = info.providerID || s.provider;
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
          }, projectID);
          return evt;
        }
        return null;
      }
      return null;
    }

    if (type === 'message.part.updated') {
      const part = props?.part;
      if (!part) return null;
      const s = this.stateFor(sessionID, undefined, projectID);

      if (part.type === 'text') {
        const textLen = typeof part.text === 'string' ? part.text.length : 0;
        log.info(`[Trajectory] text part: sessionID=${sessionID}, messageID=${part.messageID}, userMessageID=${s.userMessageID}, userText.len=${s.userText.length}, part.text.len=${textLen}`);
        if (textLen > 0 && !s.userText && (!s.userMessageID || s.userMessageID === part.messageID)) {
          s.userText = truncate(part.text, USER_TEXT_MAX) || '';
          log.info(`[Trajectory] captured userText from part: sessionID=${sessionID}, len=${textLen}`);
        } else if (textLen > 0 && s.userMessageID && s.userMessageID !== part.messageID) {
          s.assistantText = truncate(part.text, SUMMARY_MAX) || '';
          s.assistantMessageID = part.messageID;
          log.info(`[Trajectory] captured assistantText from part: sessionID=${sessionID}, len=${textLen}`);
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
          }, projectID);
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
          }, projectID);
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
        }, projectID);
        return evt;
      }

      if (part.type === 'reasoning') {
        if (!s.reasoningPartIDs.has(part.id)) {
          s.reasoningPartIDs.add(part.id);
          s.reasoningCount++;
          const evt = this.emit(sessionID, s, 'reasoning_start', {}, projectID);
          if (part.time?.end) {
            const end = this.emit(sessionID, s, 'reasoning_end', {
              durationMs: part.time.end - (part.time.start || part.time.end),
            }, projectID);
            return end;
          }
          return evt;
        } else {
          const evt = this.emit(sessionID, s, 'reasoning_end', {
            durationMs: part.time?.end ? part.time.end - (part.time.start || part.time.end) : undefined,
          }, projectID);
          return evt;
        }
      }

      return null;
    }

    return null;
  }

  onIdle(sessionID: string): TrajectoryTurn | null {
    const s = this.turns.get(sessionID);
    log.info(`[Trajectory] onIdle: sessionID=${sessionID}, hasState=${!!s}`);
    if (!s) return null;
    s.finish = s.finish || 'idle';
    const workerRole = this._roleFor?.(sessionID) ?? undefined;
    const turn: TrajectoryTurn = {
      projectID: s.projectID,
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
      provider: s.provider,
      agent: s.agent,
      userText: s.userText,
      assistantText: s.assistantText,
      workerRole,
    };
    this.store.upsertTurn(turn);
    this.emit(sessionID, s, 'turn_end', {}, s.projectID);
    this.turns.delete(sessionID);
    return turn;
  }

  private async fetchUserText(sessionID: string, messageID: string, s: TurnState): Promise<void> {
    try {
      const result = await this.opencodeClient.session.messages({
        sessionID,
        limit: 50,
      });
      const data = result?.data || [];
      const messages = Array.isArray(data) ? data : [];
      const msg = messages.find((m: any) => {
        const info = m.info || m;
        return info.id === messageID;
      });
      if (!msg) return;
      const parts = (msg.parts || msg?.info?.parts || []) as any[];
      const textPart = parts.find((p: any) => p.type === 'text' && typeof p.text === 'string');
      if (textPart && !s.userText) {
        s.userText = truncate(textPart.text, USER_TEXT_MAX) || '';
        log.info(`[Trajectory] fetched userText via API: sessionID=${sessionID}, len=${textPart.text.length}`);
        const workerRole = this._roleFor?.(sessionID) ?? undefined;
        this.store.upsertTurn({
          projectID: s.projectID,
          sessionID,
          turnID: s.turnID,
          turnStartMs: s.turnStartMs,
          turnEndMs: null,
          durationMs: null,
          toolCount: s.toolCount,
          toolErrorCount: s.toolErrorCount,
          reasoningCount: s.reasoningCount,
          agentSwitchCount: s.agentSwitchCount,
          tokens: s.tokens,
          cost: s.cost,
          finish: s.finish,
          model: s.model,
          provider: s.provider,
          agent: s.agent,
          userText: s.userText,
          workerRole,
        });
      }
    } catch (err: any) {
      log.warn(`[Trajectory] fetchUserText failed: ${err.message}`);
    }
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
