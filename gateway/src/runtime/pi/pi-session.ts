import { randomUUID } from 'crypto';
import { ApprovalBridge } from './pi-approval-bridge';
import { createMafwApprovalExtension, type ApprovalPolicy } from './pi-approval-extension';
import type { RawRuntimeEvent } from '../normalize';

export interface PiSessionDeps {
  /** 注入 createAgentSession（ESM 桥在 pi-runtime.ts 传入） */
  createSession: (opts: any) => Promise<{ session: any }>;
}

export interface PiSessionRegistryOptions {
  sessionTtlMs?: number;   // 默认 24h
  emitEvent?: (event: RawRuntimeEvent) => void;
  policy?: ApprovalPolicy;
}

export class PiSessionRegistry {
  private sessions = new Map<string, any>();
  private bySession = new Map<any, string>();
  private lastUsed = new Map<string, number>();
  private approvalBridges = new Map<string, ApprovalBridge>();
  private warnedNoReply = new Set<string>();
  private emitEvent: (event: RawRuntimeEvent) => void;
  private policy?: ApprovalPolicy;

  constructor(
    private deps: PiSessionDeps,
    private opts: PiSessionRegistryOptions = {},
  ) {
    this.emitEvent = opts.emitEvent ?? (() => {});
    this.policy = opts.policy;
  }

  async create(cwd: string, createOpts: any, agentExtensions: Array<{ name: string; factory: (pi: any) => void }> = []): Promise<{ id: string }> {
    const id = `pi_${randomUUID().slice(0, 8)}`;
    const bridge = new ApprovalBridge();
    this.approvalBridges.set(id, bridge);

    const approvalExtension = createMafwApprovalExtension(bridge, this.emitEvent, this.policy);
    // Compaction listener: pi fires session_before_compact / session_compact to
    // extensions; re-emit as normalized runtime events (compaction facet).
    const compactionExtension = {
      name: 'mafw-compaction',
      factory: (pi: any) => {
        pi.on('session_before_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacting', properties: { sessionID: id } } });
        });
        pi.on('session_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacted', properties: { sessionID: id } } });
        });
      },
    };
    // Combine approval extension with agent-specific extensions
    // These will be passed to createAgentSession via extensionFactories
    const allExtensions = [
      { name: 'mafw-approval', factory: (pi: any) => approvalExtension.on(pi) },
      compactionExtension,
      ...agentExtensions,
    ];

    try {
      const { session } = await this.deps.createSession({ cwd, ...createOpts, extensionFactories: allExtensions });
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

  async promptAsync(id: string, text: string, opts?: { system?: string; agent?: string; noReply?: boolean; expectReply?: boolean; delivery?: 'steer' | 'followup'; logWarn?: (m: string) => void; images?: Array<{ data: string; mimeType: string }> }): Promise<void> {
    const s = this.requireSession(id);
    this.touch(id);
    this.warnNoReplyOnce(id, opts);
    const piOpts = this.buildPiPromptOpts(opts);
    if (s.isStreaming) {
      const images = opts?.images ?? [];
      const deliverAs = this.resolveDelivery(opts);
      if (images.length > 0) {
        // sendUserMessage accepts a TextContent|ImageContent array; a bare
        // string would drop the attachments.
        const content = [
          { type: 'text', text },
          ...images.map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })),
        ];
        await s.sendUserMessage(content, { deliverAs });
      } else {
        await s.sendUserMessage(text, { deliverAs });
      }
    } else {
      await s.prompt(text, piOpts);
      await s.waitForIdle();
    }
  }

  async prompt(id: string, text: string, opts?: { system?: string; agent?: string; noReply?: boolean; expectReply?: boolean; delivery?: 'steer' | 'followup'; logWarn?: (m: string) => void; images?: Array<{ data: string; mimeType: string }> }): Promise<{ parts: any[]; finish?: string; usage?: { input: number; output: number; cached?: number; reasoning?: number; costUsd?: number } }> {
    const s = this.requireSession(id);
    this.touch(id);
    this.warnNoReplyOnce(id, opts);
    const piOpts = this.buildPiPromptOpts(opts);
    piOpts.streamingBehavior = this.resolveDelivery(opts);
    const before = (s.messages || []).length;
    await s.prompt(text, piOpts);
    await s.waitForIdle();
    const after = s.messages || [];
    const assistant = after.slice(before).filter((m: any) => m?.role === 'assistant');
    const last = assistant[assistant.length - 1];
    const u = last?.usage;
    return {
      parts: (last?.content || []).map((c: any) => ({ type: 'text', text: c?.text || '' })),
      finish: last?.stopReason,
      usage: u
        ? {
            input: u.input ?? u.promptTokens ?? 0,
            output: u.output ?? u.completionTokens ?? 0,
            cached: u.cacheRead ?? u.cachedTokens ?? 0,
            reasoning: u.reasoning,
            costUsd: typeof u.totalCost === 'number' ? u.totalCost : undefined,
          }
        : undefined,
    };
  }

  private buildPiPromptOpts(opts?: { system?: string; agent?: string; noReply?: boolean; images?: Array<{ data: string; mimeType: string }> }): Record<string, any> {
    if (!opts) return {};
    const piOpts: Record<string, any> = {};
    if (opts.system) piOpts.system = opts.system;
    if (opts.agent) piOpts.agent = opts.agent;
    if (opts.noReply) piOpts.noReply = opts.noReply;
    if (opts.images?.length) piOpts.images = opts.images;
    return piOpts;
  }

  /** delivery → pi 原生投递时机（busy 时 sendUserMessage/prompt 消费）。 */
  private resolveDelivery(opts?: { delivery?: 'steer' | 'followup' }): 'steer' | 'followUp' {
    return opts?.delivery === 'steer' ? 'steer' : 'followUp';
  }

  /** pi 无原生 noReply：expectReply=false 全路径降级为普通消息，每会话 warn 一次（已拍板）。 */
  private warnNoReplyOnce(id: string, opts?: { noReply?: boolean; expectReply?: boolean; logWarn?: (m: string) => void }): void {
    if (opts?.expectReply !== false && !opts?.noReply) return;
    if (this.warnedNoReply.has(id)) return;
    this.warnedNoReply.add(id);
    (opts?.logWarn ?? ((m: string) => {}))(`[PiRuntime] expectReply=false has no native pi equivalent — message delivered as normal (session ${id}, warned once)`);
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
    this.warnedNoReply.delete(id);
  }

  async permissionReply(
    sessionID: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject' | boolean,
    message?: string,
  ): Promise<boolean> {
    const bridge = this.approvalBridges.get(sessionID);
    if (!bridge) return false;
    return bridge.reply(requestId, reply as any, message);
  }

  async abort(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) { try { await s.abort(); } catch { /* ignore */ } }
  }

  /**
   * 分叉为新会话：SessionManager.createBranchedSession 写出截至 leaf 的新
   * 会话文件，再经 deps.createSession({ fromFile }) 加载为独立 AgentSession。
   * 原会话不动。busy 也允许（fork 只读文件，不动 live session）。
   */
  async fork(id: string, messageID?: string): Promise<{ id: string }> {
    const s = this.requireSession(id);
    const sm = s.sessionManager;
    if (!sm?.createBranchedSession) throw new Error('pi session does not expose sessionManager');
    const leafId = messageID ?? sm.getLeafId?.();
    if (!leafId) throw new Error(`pi fork failed: no leaf for session ${id}`);
    const file = sm.createBranchedSession(leafId);
    if (!file) throw new Error(`pi fork failed: createBranchedSession returned nothing for leaf ${leafId}`);
    const bridge = new ApprovalBridge();
    const approvalExtension = createMafwApprovalExtension(bridge, this.emitEvent, this.policy);
    const newId = `pi_${randomUUID().slice(0, 8)}`;
    const compactionExtension = {
      name: 'mafw-compaction',
      factory: (pi: any) => {
        pi.on('session_before_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacting', properties: { sessionID: newId } } });
        });
        pi.on('session_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacted', properties: { sessionID: newId } } });
        });
      },
    };
    try {
      const { session } = await this.deps.createSession({
        cwd: sm.getCwd?.() ?? undefined,
        fromFile: file,
        extensionFactories: [
          { name: 'mafw-approval', factory: (pi: any) => approvalExtension.on(pi) },
          compactionExtension,
        ],
      });
      this.sessions.set(newId, session);
      this.bySession.set(session, newId);
      this.lastUsed.set(newId, Date.now());
      this.approvalBridges.set(newId, bridge);
    } catch (err) {
      bridge.dispose();
      throw err;
    }
    return { id: newId };
  }

  /**
   * 消息级回退 = SessionManager.branch(branchFromId) 原地移动 leaf。
   * 不回滚文件、不可逆（entry 保留在文件，可凭 id 再 branch 回去）。
   * streaming 中拒绝——branch 移动 leaf 会与进行中的写入竞争。
   */
  async revert(id: string, messageID: string): Promise<void> {
    const s = this.requireSession(id);
    if (s.isStreaming) throw new Error(`pi session ${id} is busy (streaming) — abort before revert`);
    const sm = s.sessionManager;
    if (!sm?.branch) throw new Error('pi session does not expose sessionManager');
    sm.branch(messageID);
    this.touch(id);
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
    this.warnedNoReply.clear();
  }

  private requireSession(id: string): any {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Pi session not found: ${id}`);
    return s;
  }

  private touch(id: string): void { this.lastUsed.set(id, Date.now()); }
}
