import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryFact, withMemoryInjection } from '../interceptors/memory-injector';
import {
  structuredOutput,
  structuredInstruction,
  type OutputSchemaSpec,
} from '../runtime/structured-output';
import type { ThinkingLevel } from '../runtime/contract';

export interface SessionRecord {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  metadata?: Record<string, unknown>;
  time: { created: number; updated: number };
}

/** 从最终回复里取 JSON：优先 ```json 围栏，否则整段；解析失败返回 undefined。 */
function parseLooseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

export class SdkSessionResource {
  private client: any;
  private sessions: Map<string, SessionRecord> = new Map();
  private sessionsDir: string;
  public promptAsync: (sessionID: string, message: string, parts?: Array<{ type: string; [key: string]: any }>, agent?: string, model?: { providerID: string; modelID: string }, outputSchema?: OutputSchemaSpec, opts?: { delivery?: 'steer' | 'followup' | 'queue'; idempotencyKey?: string; expectReply?: boolean; thinkingLevel?: ThinkingLevel; variant?: string }) => Promise<void>;
  public prompt: (sessionID: string, parts: Array<{ type: string; text: string }>, system?: string, outputSchema?: OutputSchemaSpec, opts?: { thinkingLevel?: ThinkingLevel; variant?: string }) => Promise<{ parts: Array<{ id: string; sessionID: string; messageID: string; type: string; text: string }>; structured?: unknown; structuredError?: string }>;

  constructor(client?: any, mafwDir?: string) {
    this.client = client;
    this.sessionsDir = mafwDir ? path.join(mafwDir, 'sessions') : '';
    this.promptAsync = this._rawPromptAsync.bind(this);
    this.prompt = this._rawPrompt.bind(this);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.sessionsDir || !fs.existsSync(this.sessionsDir)) return;
    for (const file of fs.readdirSync(this.sessionsDir).filter((f: string) => f.endsWith('.json'))) {
      try {
        const record: SessionRecord = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8'));
        if (record.id) this.sessions.set(record.id, record);
      } catch { /* skip corrupt */ }
    }
  }

  private saveToDisk(record: SessionRecord): void {
    if (!this.sessionsDir) return;
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(this.sessionsDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8');
  }

  setClient(client: any) { this.client = client; }
  isReady(): boolean { return !!this.client; }

  createPromptAsyncWithInjection(memorySearch: (query: string, maxFacts: number) => Promise<MemoryFact[]>): (sessionID: string, message: string) => Promise<void> {
    return withMemoryInjection(this._rawPromptAsync.bind(this), {
      search: memorySearch,
      enabled: true,
      maxFacts: 5,
      maxTokens: 500,
    });
  }

  async create(directory: string, metadata?: Record<string, unknown>): Promise<SessionRecord> {
    // 目录必填且不得静默替换为 '.'（spec 2026-10-20-session-directory-contract-design）。
    if (!directory) throw new Error('SdkSessionResource.create: directory is required');
    let id: string;
    let projectID: string;
    let title: string;
    if (this.client) {
      try {
        const created = await this.client.session.create({ directory });
        id = created.id;
        projectID = created.projectID || '';
        title = created.title || '';
      } catch {
        // SDK unavailable — create local-only session
        id = crypto.randomUUID();
        projectID = directory;
        title = '';
      }
    } else {
      id = crypto.randomUUID();
      projectID = directory;
      title = '';
    }
    const record: SessionRecord = {
      id,
      projectID,
      directory,
      title,
      metadata,
      time: { created: Date.now(), updated: Date.now() },
    };
    this.sessions.set(record.id, record);
    this.saveToDisk(record);
    return record;
  }

  async registerExternal(id: string, directory: string, metadata?: Record<string, unknown>): Promise<SessionRecord> {
    const record: SessionRecord = {
      id,
      projectID: directory,
      directory,
      title: '',
      metadata,
      time: { created: Date.now(), updated: Date.now() },
    };
    this.sessions.set(record.id, record);
    this.saveToDisk(record);
    return record;
  }

  /** Replace (not merge) a session's metadata and persist. Returns null if unknown. */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<SessionRecord | null> {
    const record = this.sessions.get(id);
    if (!record) return null;
    record.metadata = metadata;
    record.time.updated = Date.now();
    this.saveToDisk(record);
    return record;
  }

  private async _rawPromptAsync(
    sessionID: string,
    message: string,
    parts?: Array<{ type: string; [key: string]: any }>,
    agent?: string,
    model?: { providerID: string; modelID: string },
    outputSchema?: OutputSchemaSpec,
    opts?: { delivery?: 'steer' | 'followup' | 'queue'; idempotencyKey?: string; expectReply?: boolean; thinkingLevel?: ThinkingLevel; variant?: string },
  ): Promise<void> {
    if (!this.client) throw new Error('Runtime client not available');
    if (!sessionID) return;
    const promptParts: Array<{ type: string; [key: string]: any }> = [];
    if (message) promptParts.push({ type: 'text', text: message });
    if (Array.isArray(parts) && parts.length > 0) promptParts.push(...parts);
    if (outputSchema) {
      structuredOutput.register(sessionID, outputSchema);
      promptParts.push({ type: 'text', text: structuredInstruction(outputSchema) });
    }
    const promptOpts: any = { sessionID, parts: promptParts };
    if (agent) promptOpts.agent = agent;
    if (model?.providerID && model?.modelID) promptOpts.model = model;
    if (opts?.delivery) promptOpts.delivery = opts.delivery;
    if (opts?.idempotencyKey) promptOpts.idempotencyKey = opts.idempotencyKey;
    if (opts?.expectReply !== undefined) promptOpts.expectReply = opts.expectReply;
    if (opts?.thinkingLevel) promptOpts.thinkingLevel = opts.thinkingLevel;
    if (opts?.variant) promptOpts.variant = opts.variant;
    await this.client.session.promptAsync(promptOpts);
  }

  private async _rawPrompt(
    sessionID: string,
    parts: Array<{ type: string; text: string }>,
    system?: string,
    outputSchema?: OutputSchemaSpec,
    opts?: { thinkingLevel?: ThinkingLevel; variant?: string },
  ): Promise<{ parts: Array<{ id: string; sessionID: string; messageID: string; type: string; text: string }>; structured?: unknown; structuredError?: string }> {
    if (!this.client) throw new Error('Runtime client not available');
    if (!sessionID) return { parts: [] };

    const retryCount = outputSchema
      ? Math.max(0, Math.min(3, Math.floor(outputSchema.retryCount ?? 0)))
      : 0;
    if (outputSchema) structuredOutput.register(sessionID, outputSchema);

    let promptParts = outputSchema
      ? [...parts, { type: 'text', text: structuredInstruction(outputSchema) }]
      : parts;
    let lastText = '';
    let lastError = '';

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      const result = await this.client.session.prompt({
        sessionID,
        parts: promptParts,
        system,
        ...(opts?.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
        ...(opts?.variant ? { variant: opts.variant } : {}),
      });
      lastText = result.parts
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n') || '';

      if (!outputSchema) {
        return { parts: [{ id: '', sessionID, messageID: '', type: 'text', text: lastText }] };
      }

      const submitted = structuredOutput.submitted(sessionID);
      if (submitted !== undefined) {
        return {
          parts: [{ id: '', sessionID, messageID: '', type: 'text', text: lastText }],
          structured: submitted,
        };
      }

      const parsed = parseLooseJson(lastText);
      if (parsed !== undefined) {
        const check = structuredOutput.submit(sessionID, parsed);
        if (check.ok) {
          return {
            parts: [{ id: '', sessionID, messageID: '', type: 'text', text: lastText }],
            structured: parsed,
          };
        }
        lastError = check.errors.join('\n');
      } else {
        lastError = 'no JSON object found in the final response';
      }

      if (attempt < retryCount) {
        promptParts = [
          ...parts,
          {
            type: 'text',
            text: [
              '[MAFW STRUCTURED OUTPUT] Your previous result failed validation:',
              lastError,
              'Call mafw_submit_result again with corrected data. Do not answer in prose.',
            ].join('\n'),
          },
        ];
      }
    }

    return {
      parts: [{ id: '', sessionID, messageID: '', type: 'text', text: lastText }],
      structuredError: lastError || 'structured output validation failed',
    };
  }

  async delete(sessionID: string): Promise<void> {
    if (this.client && sessionID) {
      await this.client.session.delete({ sessionID }).catch(() => {});
    }
    structuredOutput.clear(sessionID);
    this.sessions.delete(sessionID);
    if (this.sessionsDir) {
      const filePath = path.join(this.sessionsDir, `${sessionID}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  async list(): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values());
  }

  async listByProject(projectID: string): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values())
      .filter(s => s.projectID === projectID || s.directory === projectID)
      .sort((a, b) => (b.time?.created || 0) - (a.time?.created || 0));
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) || null;
  }
}
