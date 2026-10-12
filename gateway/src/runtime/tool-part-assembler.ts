/**
 * ToolPartAssembler —— 把「call/result 分离」runtime 的三原语合帧为 opencode 形状
 * ToolPart 快照。spec：docs/superpowers/specs/2026-10-12-tool-part-compat-design.md
 * per-session、callID 键控；每帧产全量快照（part.updated 语义，v2 词汇）。
 */
import { randomUUID } from 'crypto';
import type { RawRuntimeEvent } from './normalize';
import { MAFW } from './mafw-vocabulary';

export const TOOL_PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['tool.call', 'tool.delta', 'tool.result']);

export interface ToolCallPrimitive {
  sessionID: string; messageID?: string; callID: string; tool: string;
  input?: Record<string, unknown>; title?: string;
}
export interface ToolDeltaPrimitive {
  sessionID: string; callID: string; kind: 'input' | 'output'; text: string;
}
export interface ToolResultPrimitive {
  sessionID: string; callID: string; output?: unknown; isError?: boolean;
  tool?: string; input?: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>;
}

export function coerceOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('');
  }
  try { return JSON.stringify(output); } catch { return String(output); }
}

interface WorkingPart {
  messageID: string; tool: string; callID: string;
  input: Record<string, unknown>; rawInput: string;
  status: 'pending' | 'running'; startMs: number;
}
interface SessionState {
  lastAssistantMessageID?: string;
  syntheticAnchorID?: string;
  working: Map<string, WorkingPart>;
}

function hasInput(input: Record<string, unknown> | undefined): boolean {
  return !!input && Object.keys(input).length > 0;
}

export class ToolPartAssembler {
  private sessions = new Map<string, SessionState>();
  private now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
  }

  private stateFor(sessionID: string): SessionState {
    let s = this.sessions.get(sessionID);
    if (!s) { s = { working: new Map() }; this.sessions.set(sessionID, s); }
    return s;
  }

  /** 从过路 canonical 事件学习当前 assistant 消息锚点。 */
  observeAnchor(evt: RawRuntimeEvent): void {
    const type = (evt as any)?.payload?.type;
    const props = (evt as any)?.payload?.properties;
    const sid = (evt as any)?.sessionID ?? props?.sessionID ?? props?.part?.sessionID ?? props?.info?.sessionID;
    if (typeof sid !== 'string' || !sid) return;
    const s = this.stateFor(sid);
    if (type === MAFW.partUpdated) {
      const mid = props?.part?.messageID;
      if (typeof mid === 'string' && mid) s.lastAssistantMessageID = mid;
    } else if (type === MAFW.messageUpdated) {
      const info = props?.info;
      if (info?.role === 'assistant' && typeof info?.id === 'string' && info.id) s.lastAssistantMessageID = info.id;
    }
  }

  /** 锚点缺失时合成 assistant 消息（每 session 一次），返回前置事件（如有）。 */
  private ensureAnchor(sessionID: string, explicit?: string): { messageID: string; pre: RawRuntimeEvent[] } {
    if (explicit) return { messageID: explicit, pre: [] };
    const s = this.stateFor(sessionID);
    if (s.lastAssistantMessageID) return { messageID: s.lastAssistantMessageID, pre: [] };
    if (!s.syntheticAnchorID) {
      s.syntheticAnchorID = `asst_${sessionID}_synth`;
      const info = { id: s.syntheticAnchorID, role: 'assistant', sessionID, parentID: null, time: { created: this.now() } };
      return { messageID: s.syntheticAnchorID, pre: [{ payload: { type: MAFW.messageUpdated, properties: { info } }, sessionID } as any] };
    }
    return { messageID: s.syntheticAnchorID, pre: [] };
  }

  private partEvent(sessionID: string, part: any): RawRuntimeEvent {
    return { payload: { type: MAFW.partUpdated, properties: { part } }, sessionID } as any;
  }

  applyCall(p: ToolCallPrimitive): RawRuntimeEvent[] {
    const callID = p.callID || randomUUID().slice(0, 8);
    const { messageID, pre } = this.ensureAnchor(p.sessionID, p.messageID);
    const s = this.stateFor(p.sessionID);
    const w: WorkingPart = {
      messageID, tool: p.tool, callID,
      input: p.input ?? {}, rawInput: '',
      status: hasInput(p.input) ? 'running' : 'pending', startMs: this.now(),
    };
    s.working.set(callID, w);
    return [...pre, this.partEvent(p.sessionID, {
      id: `toolpart_${callID}`, sessionID: p.sessionID, messageID, type: 'tool', callID, tool: p.tool,
      state: { status: w.status, input: w.input, raw: '', time: { start: w.startMs } },
    })];
  }

  applyDelta(p: ToolDeltaPrimitive): RawRuntimeEvent[] {
    const s = this.stateFor(p.sessionID);
    const w = p.callID ? s.working.get(p.callID) : undefined;
    if (!w) return [];
    if (p.kind === 'input') {
      w.rawInput += p.text;
      try {
        const parsed = JSON.parse(w.rawInput);
        if (parsed && typeof parsed === 'object') { w.input = parsed; w.status = 'running'; }
      } catch { /* 增量未完成 */ }
      return [this.partEvent(p.sessionID, {
        id: `toolpart_${w.callID}`, sessionID: p.sessionID, messageID: w.messageID, type: 'tool', callID: w.callID, tool: w.tool,
        state: { status: w.status, input: w.input, raw: w.rawInput, time: { start: w.startMs } },
      })];
    }
    // output delta：只推进状态，默认不广播增量（能力位预留）
    w.status = 'running';
    return [];
  }

  applyResult(p: ToolResultPrimitive): RawRuntimeEvent[] {
    const s = this.stateFor(p.sessionID);
    const callID = p.callID || randomUUID().slice(0, 8);
    let w = s.working.get(callID);
    let pre: RawRuntimeEvent[] = [];
    if (!w) {
      const anchor = this.ensureAnchor(p.sessionID);
      pre = anchor.pre;
      w = {
        messageID: anchor.messageID, tool: p.tool ?? 'unknown', callID,
        input: p.input ?? {}, rawInput: '', status: 'running', startMs: this.now(),
      };
      s.working.set(callID, w);
    }
    const endMs = this.now();
    const output = coerceOutput(p.output);
    const state = p.isError
      ? { status: 'error', input: w.input, error: output, time: { start: w.startMs, end: endMs } }
      : { status: 'completed', input: w.input, output, title: p.title ?? w.tool, metadata: p.metadata ?? {}, time: { start: w.startMs, end: endMs } };
    return [...pre, this.partEvent(p.sessionID, {
      id: `toolpart_${callID}`, sessionID: p.sessionID, messageID: w.messageID, type: 'tool', callID, tool: w.tool, state,
    })];
  }

  dropSession(sessionID: string): void {
    this.sessions.delete(sessionID);
  }
}

/** 从映射后的 canonical 事件取原语载荷（sessionID 注入在 properties，兼容 evt.sessionID 兜底）。 */
function primitiveOf(evt: any): any {
  const props = evt?.payload?.properties ?? {};
  return { ...props, sessionID: props.sessionID ?? evt?.sessionID };
}

/**
 * 包装 runtime.global.event()：三原语进 assembler 合成 ToolPart 快照，其余透传。
 * 必须在 wrapGlobalEventStream 之后应用（消费映射后的事件流）。
 * opencode 无三原语 → 恒等直通。
 */
export function wrapToolPartAssembly(rt: any): void {
  const assembler = new ToolPartAssembler();
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        const t = raw?.payload?.type;
        if (t === 'tool.call') { yield* assembler.applyCall(primitiveOf(raw)); continue; }
        if (t === 'tool.delta') { yield* assembler.applyDelta(primitiveOf(raw)); continue; }
        if (t === 'tool.result') { yield* assembler.applyResult(primitiveOf(raw)); continue; }
        assembler.observeAnchor(raw);
        yield raw;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
