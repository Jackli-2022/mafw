/**
 * RuntimeChannels: everything a runtime exposes outside the turn protocol.
 * All blocks are optional; a missing block means the surface is unsupported
 * (ENODEV / 503), never a runtime-specific fallback.
 */

export interface RuntimeChannels {
  session?: {
    list?(opts?: { directory?: string }): Promise<unknown[]>;
    listByDirectory?(directory: string, limit?: number): Promise<unknown[]>;
    get?(sessionID: string): Promise<unknown>;
    update?(sessionID: string, patch: { title?: string }): Promise<void>;
    delete?(sessionID: string): Promise<void>;
    abort?(sessionID: string): Promise<void>;
  };
  messages?: {
    list(sessionID: string, opts?: { limit?: number; before?: string }): Promise<{ data: unknown[]; nextCursor?: string }>;
    normalize?(raw: unknown[]): unknown[];
  };
  providers?: {
    list(): Promise<{ all: unknown[]; connected: string[]; default: Record<string, string> }>;
  };
  agents?: {
    list(): Promise<unknown[]>;
    install(name: string, definition: unknown): Promise<void>;
    remove?(name: string): Promise<void>;
  };
  branch?: {
    fork?(sessionID: string, messageID?: string): Promise<{ sessionID: string }>;
    revert?(sessionID: string, messageID: string, opts?: { files?: boolean }): Promise<void>;
    unrevert?(sessionID: string): Promise<void>;
  };
  diff?: {
    get?(sessionID: string, messageID?: string): Promise<unknown[]>;
    vcsDiff?(opts?: { mode?: 'git' | 'branch' }): Promise<unknown[]>;
    vcsApply?(patch: string): Promise<void>;
  };
  question?: {
    list(opts?: { directory?: string }): Promise<unknown[]>;
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
