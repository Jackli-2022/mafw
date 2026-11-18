import type { OutputSchemaSpec } from './structured-output';
import type { RuntimeChildSession, RuntimeLifecycle } from './contract';

export type SubagentStatus = 'running' | 'waiting' | 'unknown' | 'completed' | 'failed' | 'aborted';

export interface SubagentRecord {
  id: string;
  parentID: string;
  depth: number;
  agent?: string;
  description?: string;
  status: SubagentStatus;
  lifecycle?: RuntimeLifecycle;
  background?: boolean;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface SpawnSubagentOpts {
  parentID: string;
  directory?: string;
  agent?: string;
  description?: string;
  prompt: string;
  background?: boolean;
  model?: { providerID: string; modelID: string };
  outputSchema?: OutputSchemaSpec;
}

export interface SubagentServiceDeps {
  createSession(opts: { directory: string; parentID: string }): Promise<{ id: string }>;
  getSession(sessionID: string): Promise<RuntimeChildSession | null | undefined>;
  /** Missing = the runtime has no child-session enumeration (do not fake []). */
  children?(parentID: string, opts?: { cursor?: string; limit?: number }): Promise<RuntimeChildSession[]>;
  promptChild(opts: {
    sessionID: string;
    prompt: string;
    agent?: string;
    model?: { providerID: string; modelID: string };
    outputSchema?: OutputSchemaSpec;
  }): Promise<void>;
  messageChild(sessionID: string, text: string): Promise<void>;
  abortChild(sessionID: string): Promise<void>;
  messages(sessionID: string, limit: number): Promise<any>;
  submitted(sessionID: string): unknown | undefined;
  broadcast(event: any): void;
}

export class SubagentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const DEPTH_CAP = 32;

/**
 * Canonical lifecycle → SubagentStatus. Missing lifecycle is `unknown`, not
 * `running`: a runtime that cannot prove liveness must not look active.
 */
export function statusOfLifecycle(lifecycle: RuntimeLifecycle | undefined | null): SubagentStatus {
  if (!lifecycle) return 'unknown';
  switch (lifecycle.phase) {
    case 'active':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'settled':
      switch (lifecycle.outcome) {
        case 'failed':
          return 'failed';
        case 'cancelled':
        case 'aborted':
          return 'aborted';
        default:
          return 'completed';
      }
    default:
      return 'unknown';
  }
}

/**
 * 会话查询结果：区分**运行时暂时不可达**（ok:false，serve 重启/网络抖动）与
 * **查询成功但会话确实不存在**（ok:true, info:null）。只有后者可以推 aborted——
 * 把瞬时失败当「不存在」会让在跑的子代理被报成 aborted/cancelled（background
 * jobs 以此为准时就是假终态）。
 */
type SessionLookup = { ok: true; info: RuntimeChildSession | null | undefined } | { ok: false };

function textOfMessages(result: any): string {
  const list = Array.isArray(result) ? result : (result?.data ?? []);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.role !== 'assistant') continue;
    const parts = Array.isArray(m?.content) ? m.content : [];
    const text = parts
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

export class SubagentService {
  private records = new Map<string, SubagentRecord>();
  private depthCache = new Map<string, number>();

  constructor(private readonly deps: SubagentServiceDeps) {}

  async depthOf(sessionID: string): Promise<number> {
    if (!sessionID) return 0;
    const cached = this.depthCache.get(sessionID);
    if (cached !== undefined) return cached;
    let current = sessionID;
    let depth = 0;
    const seen = new Set<string>();
    while (current && depth < DEPTH_CAP) {
      if (seen.has(current)) break;
      seen.add(current);
      const info = await this.deps.getSession(current).catch(() => null);
      if (!info) return sessionID === current ? 0 : 1;
      if (!info.parentID) {
        this.depthCache.set(sessionID, depth);
        return depth;
      }
      depth += 1;
      current = String(info.parentID);
    }
    this.depthCache.set(sessionID, depth);
    return depth;
  }

  async spawn(opts: SpawnSubagentOpts): Promise<SubagentRecord> {
    if (!opts?.prompt?.trim()) throw new SubagentError(400, 'prompt is required');
    const parent = await this.deps.getSession(opts.parentID).catch(() => null);
    if (!parent) throw new SubagentError(404, `parent session not found: ${opts.parentID}`);
    const directory = opts.directory || parent.directory || parent.location?.directory;
    if (!directory) throw new SubagentError(400, 'parent session has no directory');

    const child = await this.deps.createSession({ directory, parentID: opts.parentID });
    if (!child?.id) throw new SubagentError(502, 'runtime did not return a child session id');

    const depth = (await this.depthOf(opts.parentID)) + 1;
    const now = Date.now();
    const record: SubagentRecord = {
      id: child.id,
      parentID: opts.parentID,
      depth,
      agent: opts.agent,
      description: opts.description,
      status: 'running',
      background: opts.background === true,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(child.id, record);
    this.depthCache.set(child.id, depth);

    try {
      await this.deps.promptChild({
        sessionID: child.id,
        prompt: opts.prompt,
        agent: opts.agent,
        model: opts.model,
        outputSchema: opts.outputSchema,
      });
    } catch (err: any) {
      record.status = 'failed';
      record.error = err?.message ?? String(err);
      record.updatedAt = Date.now();
      return record;
    }

    const lookup = await this.lookupSession(child.id);
    // This spawn is a local fact: until the adapter returns lifecycle evidence,
    // the child is active. A later list/result without lifecycle becomes unknown.
    if (lookup.ok) {
      record.lifecycle = lookup.info?.lifecycle;
      if (record.lifecycle) record.status = statusOfLifecycle(record.lifecycle);
    }
    record.updatedAt = Date.now();
    this.emitCreated(record, lookup.ok ? lookup.info : null, directory);
    return record;
  }

  async list(parentID: string): Promise<SubagentRecord[]> {
    const rows = new Map<string, SubagentRecord>();
    for (const record of this.records.values()) {
      if (record.parentID !== parentID) continue;
      const lookup = await this.lookupSession(record.id);
      // 瞬时查询失败（serve 重启等）：保留最后已知状态，绝不伪造成 aborted。
      if (lookup.ok) {
        record.lifecycle = lookup.info?.lifecycle;
        record.status = statusOfLifecycle(record.lifecycle);
        record.updatedAt = record.lifecycle?.observedAt
          ?? record.lifecycle?.lastActivityAt
          ?? lookup.info?.time?.updated
          ?? Date.now();
      }
      rows.set(record.id, { ...record });
    }

    const children = this.deps.children
      ? await this.deps.children(parentID).catch(() => [])
      : [];
    const parentDepth = await this.depthOf(parentID);
    for (const child of Array.isArray(children) ? children : []) {
      if (!child?.id || rows.has(child.id)) continue;
      const lookup = await this.lookupSession(child.id);
      // 瞬时失败 → 用 children 快照（advisory）；只有「查询成功且为空」才算确实不存在
      const info = lookup.ok ? lookup.info : child;
      const lifecycle = info?.lifecycle ?? child.lifecycle;
      rows.set(child.id, {
        id: child.id,
        parentID,
        depth: typeof child.depth === 'number' ? child.depth : parentDepth + 1,
        agent: info?.agent ?? child.agent,
        description: info?.title ?? child.title,
        status: statusOfLifecycle(lifecycle),
        lifecycle,
        background: false,
        createdAt: info?.time?.created ?? child.time?.created ?? Date.now(),
        updatedAt: lifecycle?.observedAt ?? lifecycle?.lastActivityAt
          ?? info?.time?.updated ?? child.time?.updated ?? Date.now(),
      });
    }

    return [...rows.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async message(parentID: string, childID: string, text: string): Promise<void> {
    if (!text?.trim()) throw new SubagentError(400, 'message is required');
    await this.assertOwnership(parentID, childID);
    await this.deps.messageChild(childID, `[from parent ${parentID}] ${text}`);
  }

  async cancel(parentID: string, childID: string): Promise<void> {
    await this.assertOwnership(parentID, childID);
    await this.deps.abortChild(childID);
    const record = this.records.get(childID);
    if (record) {
      record.status = 'aborted';
      record.updatedAt = Date.now();
    }
  }

  async result(parentID: string, childID: string): Promise<{ status: SubagentStatus; structured?: unknown; text?: string }> {
    await this.assertOwnership(parentID, childID);
    const info = await this.deps.getSession(childID).catch(() => null);
    const status = statusOfLifecycle(info?.lifecycle);
    const structured = this.deps.submitted(childID);
    if (structured !== undefined) return { status, structured };
    const messages = await this.deps.messages(childID, 5).catch(() => null);
    return { status, text: textOfMessages(messages) };
  }

  /** 区分「暂时不可达」与「确实不存在」——终态推断只能基于后者。 */
  private async lookupSession(sessionID: string): Promise<SessionLookup> {
    try {
      return { ok: true, info: await this.deps.getSession(sessionID) };
    } catch {
      return { ok: false };
    }
  }

  private async assertOwnership(parentID: string, childID: string): Promise<void> {
    const known = this.records.get(childID);
    if (known) {
      if (known.parentID !== parentID) throw new SubagentError(404, `subagent not found: ${childID}`);
      return;
    }
    const info = await this.deps.getSession(childID).catch(() => null);
    if (!info || info.parentID !== parentID) {
      throw new SubagentError(404, `subagent not found: ${childID}`);
    }
  }

  private emitCreated(record: SubagentRecord, info: any, directory: string): void {
    const childInfo = {
      ...(info && typeof info === 'object' ? info : {}),
      id: record.id,
      parentID: record.parentID,
      depth: record.depth,
      title: info?.title ?? record.description ?? 'Subagent',
      agent: info?.agent ?? record.agent,
      directory: info?.directory ?? directory,
      lifecycle: info?.lifecycle,
      time: info?.time ?? { created: record.createdAt, updated: record.updatedAt },
    };
    this.deps.broadcast({
      type: 'session.created',
      sessionID: record.id,
      properties: { sessionID: record.id, info: childInfo },
    });
  }
}
