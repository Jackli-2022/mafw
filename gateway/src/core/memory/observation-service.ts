import { T1Store } from './t1-store';
import { T1ToT2Compressor } from './t1-to-t2-compressor';

export type ObservationSource = 'user_input' | 'assistant_reply' | 'tool_result';

export const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export interface ObservationServiceConfig {
  t1Store: T1Store;
  compressor: T1ToT2Compressor;
  maxContentLength?: number;
}

export class ObservationService {
  private t1Store: T1Store;
  private compressor: T1ToT2Compressor;
  private maxContent: number;
  private sessionTurns: Map<string, number>;
  private sessionStarted: Map<string, number>;

  constructor(config: ObservationServiceConfig) {
    this.t1Store = config.t1Store;
    this.compressor = config.compressor;
    this.maxContent = config.maxContentLength || 2000;
    this.sessionTurns = new Map();
    this.sessionStarted = new Map();
  }

  captureUserInput(sessionID: string, text: string, goalId?: string): void {
    if (!text || !sessionID) return;
    const turn = (this.sessionTurns.get(sessionID) || 0) + 1;
    this.sessionTurns.set(sessionID, turn);
    if (!this.sessionStarted.has(sessionID)) {
      this.sessionStarted.set(sessionID, Date.now());
    }
    this.t1Store.append({
      content: this.truncate(text),
      source: 'user_input' as ObservationSource,
      sessionID,
      turnID: turn,
      goalId,
      timestamp: Date.now(),
      energy: 0.8,
    }, goalId);
  }

  captureAssistantReply(sessionID: string, text: string, goalId?: string): void {
    if (!text || !sessionID) return;
    const turn = this.sessionTurns.get(sessionID) || 0;
    this.t1Store.append({
      content: this.truncate(text),
      source: 'assistant_reply' as ObservationSource,
      sessionID,
      turnID: turn,
      goalId,
      timestamp: Date.now(),
      energy: 0.75,
    }, goalId);
  }

  captureToolResult(sessionID: string, toolName: string, output: string, args?: string, goalId?: string, loopNum?: number): void {
    if (!sessionID || (!output && !args)) return;
    const turn = this.sessionTurns.get(sessionID) || 0;
    const content = args
      ? `[${toolName}] args: ${this.truncate(args || '')}\noutput: ${this.truncate(output || '')}`
      : `[${toolName}] ${this.truncate(output || '')}`;
    this.t1Store.append({
      content,
      source: 'tool_result' as ObservationSource,
      toolName,
      sessionID,
      turnID: turn,
      loopNum,
      goalId,
      timestamp: Date.now(),
      energy: 0.7,
    }, goalId);
  }

  async endSession(sessionID: string, goalId?: string): Promise<void> {
    if (!sessionID) return;
    const started = this.sessionStarted.get(sessionID);
    const elapsed = started ? Date.now() - started : 0;
    if (elapsed <= SESSION_TIMEOUT_MS && this.t1Store.hasSession(sessionID, goalId)) {
      await this.compressor.compressSession(sessionID, goalId);
    }
    this.sessionTurns.delete(sessionID);
    this.sessionStarted.delete(sessionID);
  }

  private truncate(text: string): string {
    if (text.length <= this.maxContent) return text;
    const half = Math.floor((this.maxContent - 20) / 2);
    return text.substring(0, half) + '\n...[truncated]...\n' + text.substring(text.length - half);
  }
}
