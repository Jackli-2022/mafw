import { randomUUID } from 'crypto';
import { ApprovalBridge } from './pi-approval-bridge';
import { createMafwApprovalExtension } from './pi-approval-extension';
import type { RawRuntimeEvent } from '../normalize';

export interface PiSessionDeps {
  /** 注入 createAgentSession（ESM 桥在 pi-runtime.ts 传入） */
  createSession: (opts: any) => Promise<{ session: any }>;
}

export interface PiSessionRegistryOptions {
  sessionTtlMs?: number;   // 默认 24h
}

export class PiSessionRegistry {
  private sessions = new Map<string, any>();
  private bySession = new Map<any, string>();
  private lastUsed = new Map<string, number>();
  private approvalBridges = new Map<string, ApprovalBridge>();
  private emitEvent: (event: RawRuntimeEvent) => void;

  constructor(
    private deps: PiSessionDeps,
    private opts: PiSessionRegistryOptions = {},
    emitEvent?: (event: RawRuntimeEvent) => void,
  ) {
    this.emitEvent = emitEvent ?? (() => {});
  }

  async create(cwd: string, createOpts: any): Promise<{ id: string }> {
    const id = `pi_${randomUUID().slice(0, 8)}`;
    const bridge = new ApprovalBridge();
    this.approvalBridges.set(id, bridge);

    const extension = createMafwApprovalExtension(bridge, this.emitEvent);
    try {
      const { session } = await this.deps.createSession({ cwd, ...createOpts, extensions: [extension] });
      this.sessions.set(id, session);
      this.bySession.set(session, id);
      this.lastUsed.set(id, Date.now());
    } catch (err) {
      this.approvalBridges.delete(id);
      throw err;
    }
    return { id };
  }

  sessionFor(id: string): any | undefined { return this.sessions.get(id); }

  sessionIdFor(session: any): string | undefined { return this.bySession.get(session); }

  async promptAsync(id: string, text: string): Promise<void> {
    const s = this.requireSession(id);
    this.touch(id);
    if (s.isStreaming) {
      await s.sendUserMessage(text, { deliverAs: 'followUp' });
    } else {
      await s.prompt(text, {});
      await s.waitForIdle();
    }
  }

  async prompt(id: string, text: string): Promise<{ parts: any[] }> {
    const s = this.requireSession(id);
    this.touch(id);
    const before = (s.messages || []).length;
    await s.prompt(text, {});
    await s.waitForIdle();
    const after = s.messages || [];
    const assistant = after.slice(before).filter((m: any) => m?.role === 'assistant');
    return { parts: (assistant[assistant.length - 1]?.content || []).map((c: any) => ({ type: 'text', text: c?.text || '' })) };
  }

  async messages(id: string): Promise<{ data: any[] }> {
    const s = this.requireSession(id);
    this.touch(id);
    return { data: s.messages || [] };
  }

  async delete(id: string): Promise<void> {
    const bridge = this.approvalBridges.get(id);
    if (bridge) {
      bridge.dispose();
      this.approvalBridges.delete(id);
    }
    const s = this.sessions.get(id);
    if (s) { try { await s.dispose(); } catch { /* ignore */ } }
    this.sessions.delete(id);
    this.bySession.delete(s);
    this.lastUsed.delete(id);
  }

  async permissionReply(sessionID: string, requestId: string, approved: boolean): Promise<boolean> {
    const bridge = this.approvalBridges.get(sessionID);
    if (!bridge) return false;
    return bridge.reply(requestId, approved);
  }

  async abort(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) { try { await s.abort(); } catch { /* ignore */ } }
  }

  async list(): Promise<any[]> {
    return [...this.sessions.keys()].map((id) => ({ id, directory: '', title: '', time: { created: 0, updated: 0 } }));
  }

  async get(id: string): Promise<any> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    return { id, directory: '', title: '', time: { created: 0, updated: this.lastUsed.get(id) ?? 0 } };
  }

  async todo(): Promise<any[]> { return []; }
  async children(): Promise<any[]> { return []; }

  async summarize(id: string): Promise<any> {
    const s = this.requireSession(id);
    return s.compact();
  }

  async disposeAll(): Promise<void> {
    for (const bridge of this.approvalBridges.values()) {
      bridge.dispose();
    }
    this.approvalBridges.clear();
    for (const s of this.sessions.values()) {
      try { await s.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.bySession.clear();
    this.lastUsed.clear();
  }

  private requireSession(id: string): any {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Pi session not found: ${id}`);
    return s;
  }

  private touch(id: string): void { this.lastUsed.set(id, Date.now()); }
}