import type { OutputSchemaSpec } from './structured-output';

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface SubagentRecord {
  id: string;
  parentID: string;
  depth: number;
  agent?: string;
  description?: string;
  status: SubagentStatus;
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
  getSession(sessionID: string): Promise<any>;
  children(parentID: string): Promise<any[]>;
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

function statusOf(info: any): SubagentStatus {
  if (!info) return 'aborted';
  if (info.time?.idle || info.time?.completed) {
    if (info.outcome === 'failed') return 'failed';
    if (info.outcome === 'interrupted') return 'aborted';
    return 'completed';
  }
  return 'running';
}

function textOfMessages(result: any): string {
  const list = Array.isArray(result) ? result : (result?.data ?? []);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const info = m?.info ?? m;
    if ((info?.role ?? info?.type) !== 'assistant') continue;
    const parts = Array.isArray(m?.parts) ? m.parts : (Array.isArray(m?.content) ? m.content : []);
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

    const info = await this.deps.getSession(child.id).catch(() => null);
    record.status = statusOf(info);
    record.updatedAt = Date.now();
    this.emitCreated(record, info, directory);
    return record;
  }

  async list(parentID: string): Promise<SubagentRecord[]> {
    const rows = new Map<string, SubagentRecord>();
    for (const record of this.records.values()) {
      if (record.parentID !== parentID) continue;
      const info = await this.deps.getSession(record.id).catch(() => null);
      record.status = statusOf(info);
      record.updatedAt = Date.now();
      rows.set(record.id, { ...record });
    }

    const children = await this.deps.children(parentID).catch(() => []);
    const parentDepth = await this.depthOf(parentID);
    for (const child of Array.isArray(children) ? children : []) {
      if (!child?.id || rows.has(child.id)) continue;
      const info = await this.deps.getSession(child.id).catch(() => child);
      rows.set(child.id, {
        id: child.id,
        parentID,
        depth: typeof child.depth === 'number' ? child.depth : parentDepth + 1,
        agent: info?.agent ?? child.agent,
        description: info?.title ?? child.title,
        status: statusOf(info),
        background: false,
        createdAt: info?.time?.created ?? child.time?.created ?? Date.now(),
        updatedAt: Date.now(),
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
    const status = statusOf(info);
    const structured = this.deps.submitted(childID);
    if (structured !== undefined) return { status, structured };
    const messages = await this.deps.messages(childID, 5).catch(() => null);
    return { status, text: textOfMessages(messages) };
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
      time: info?.time ?? { created: record.createdAt, updated: record.updatedAt },
    };
    this.deps.broadcast({
      type: 'session.created',
      sessionID: record.id,
      properties: { sessionID: record.id, info: childInfo },
    });
  }
}
