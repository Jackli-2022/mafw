/**
 * RuntimeChannels: everything a runtime exposes outside the turn protocol.
 * All blocks are optional; a missing block means the surface is unsupported
 * (ENODEV / 503), never a runtime-specific fallback.
 */

export interface AdapterSession {
  id: string;
  status?: string;
  title?: string;
  directory?: string;
  parentID?: string;
  model?: unknown;
  time?: { created?: number; updated?: number };
}

export interface AdapterMessage {
  id?: string;
  sessionID?: string;
  role: 'user' | 'assistant';
  content?: unknown[];
  time?: { created?: number; updated?: number; completed?: number };
}

export interface AdapterPart {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: string;
}

export interface AdapterProvider {
  id: string;
  name?: string;
  models: unknown[];
  connected?: boolean;
}

export interface AdapterAgent {
  id: string;
  label: string;
  source?: string;
  selectable?: boolean;
}

export interface AdapterQuestionRequest {
  id: string;
  sessionID: string;
  questions: unknown[];
}

export interface AdapterDiff {
  file: string;
  patch?: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface RuntimeChannels {
  tools?: {
    registerTools(factory: (sessionID: string) => unknown[]): void | Promise<void>;
    nativeTools?(): unknown[];
  };
  session?: {
    list?(opts?: { directory?: string }): Promise<AdapterSession[]>;
    listByDirectory?(directory: string, limit?: number): Promise<AdapterSession[]>;
    get?(sessionID: string): Promise<AdapterSession>;
    update?(sessionID: string, patch: { title?: string }): Promise<void>;
    delete?(sessionID: string): Promise<void>;
    abort?(sessionID: string): Promise<void>;
  };
  messages?: {
    list(sessionID: string, opts?: { limit?: number; before?: string }): Promise<{ data: AdapterMessage[]; nextCursor?: string }>;
    normalize?(raw: unknown[]): AdapterMessage[];
  };
  providers?: {
    list(): Promise<{ all: AdapterProvider[]; connected: string[]; default: Record<string, string> }>;
  };
  agents?: {
    list(): Promise<AdapterAgent[]>;
    install(name: string, definition: unknown): Promise<void>;
    remove?(name: string): Promise<void>;
  };
  branch?: {
    fork?(sessionID: string, messageID?: string): Promise<{ sessionID: string }>;
    revert?(sessionID: string, messageID: string, opts?: { files?: boolean }): Promise<void>;
    unrevert?(sessionID: string): Promise<void>;
  };
  diff?: {
    get?(sessionID: string, messageID?: string): Promise<AdapterDiff[]>;
    vcsDiff?(opts?: { mode?: 'git' | 'branch' }): Promise<AdapterDiff[]>;
    vcsApply?(patch: string): Promise<void>;
  };
  question?: {
    list(opts?: { directory?: string }): Promise<AdapterQuestionRequest[]>;
    reply(opts: { requestID: string; answers: string[][]; directory?: string }): Promise<void>;
    reject(opts: { requestID: string; directory?: string }): Promise<void>;
  };
  completion?: {
    complete(req: unknown): Promise<unknown>;
  };
  shell?: {
    create(opts: { command: string; cwd?: string; timeout?: number }): Promise<{ shellID: string }>;
    get(shellID: string): Promise<unknown>;
    output(shellID: string, opts?: { cursor?: number; limit?: number }): Promise<unknown>;
    remove(shellID: string): Promise<void>;
  };
  mediaSession?: {
    create(opts: { directory: string }): Promise<{ sessionID: string }>;
  };
}

/**
 * v2 channels, delivered in the same release as v1 (user ruling).
 * Payload types are structural placeholders in Plan 1; Plan 2 replaces them
 * with the shared DTO types. Method names/shapes stay.
 */
export interface RuntimeChannelsV2 {
  mcp?: {
    list(opts?: { directory?: string }): Promise<unknown[]>;
    connect?(name: string): Promise<void>;
    disconnect?(name: string): Promise<void>;
    config?: unknown;
  };
  discovery?: {
    list(input?: { directory?: string }): Promise<unknown>;
    loadSkill?(key: string): Promise<string>;
  };
  instructions?: {
    list(sessionID: string): Promise<Array<{ key: string; value: unknown }>>;
    put(sessionID: string, key: string, value: unknown): Promise<void>;
    remove(sessionID: string, key: string): Promise<void>;
  };
  pty?: unknown;
  checkpoint?: {
    snapshotTree?(sessionID: string, messageID?: string): Promise<unknown>;
  };
  background?: {
    toBackground?(sessionID: string): Promise<void>;
    list?(): Promise<unknown[]>;
    cancel?(jobID: string): Promise<void>;
  };
}

