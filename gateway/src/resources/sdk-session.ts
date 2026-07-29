import * as fs from 'fs';
import * as path from 'path';
import { MemoryFact, withMemoryInjection } from '../interceptors/memory-injector';

export interface SessionRecord {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  time: { created: number; updated: number };
}

export class SdkSessionResource {
  private opencodeClient: any;
  private sessions: Map<string, SessionRecord> = new Map();
  private sessionsDir: string;
  public promptAsync: (sessionID: string, message: string) => Promise<void>;
  public prompt: (sessionID: string, parts: Array<{ type: string; text: string }>, system?: string) => Promise<{ parts: Array<{ id: string; sessionID: string; messageID: string; type: string; text: string }> }>;

  constructor(opencodeClient?: any, mafwDir?: string) {
    this.opencodeClient = opencodeClient;
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

  setClient(client: any) { this.opencodeClient = client; }
  isReady(): boolean { return !!this.opencodeClient; }

  createPromptAsyncWithInjection(memorySearch: (query: string, maxFacts: number) => Promise<MemoryFact[]>): (sessionID: string, message: string) => Promise<void> {
    return withMemoryInjection(this._rawPromptAsync.bind(this), {
      search: memorySearch,
      enabled: true,
      maxFacts: 5,
      maxTokens: 500,
    });
  }

  async create(directory?: string, metadata?: Record<string, unknown>): Promise<SessionRecord> {
    if (!this.opencodeClient) throw new Error('OpenCode client not available');
    const result = await this.opencodeClient.session.create({
      directory: directory || '.',
      metadata: { ...metadata, mafw: true },
    });
    const record: SessionRecord = {
      id: result.id,
      projectID: result.projectID || '',
      directory: directory || result.directory || '.',
      title: result.title || '',
      time: { created: Date.now(), updated: Date.now() },
    };
    this.sessions.set(record.id, record);
    this.saveToDisk(record);
    return record;
  }

  private async _rawPromptAsync(sessionID: string, message: string): Promise<void> {
    if (!this.opencodeClient) throw new Error('OpenCode client not available');
    await this.opencodeClient.session.promptAsync({ sessionID, message });
  }

  private async _rawPrompt(
    sessionID: string,
    parts: Array<{ type: string; text: string }>,
    system?: string,
  ): Promise<{ parts: Array<{ id: string; sessionID: string; messageID: string; type: string; text: string }> }> {
    if (!this.opencodeClient) throw new Error('OpenCode client not available');
    const result = await this.opencodeClient.session.prompt({
      path: { id: sessionID },
      body: { parts, system },
    });

    const responseText = result.parts
      ?.filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n') || '';

    return {
      parts: [{ id: '', sessionID, messageID: '', type: 'text', text: responseText }],
    };
  }

  async delete(sessionID: string): Promise<void> {
    if (this.opencodeClient) {
      await this.opencodeClient.session.delete({ sessionID }).catch(() => {});
    }
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
