import * as fs from 'fs';
import * as path from 'path';
import type { MafwCommandDef } from '../../commands/registry';
import type { AgentRuntime, RuntimeCommandInfo, RuntimeSkillInfo } from '../../runtime/contract';
import { discoverAgentsFiles } from './agents-files';
import { computeRevision, mergeCommands, mergeSkills } from './merge';
import type {
  DiscoveryCommand,
  DiscoveryDegradedReason,
  DiscoveryInstruction,
  DiscoverySkill,
  DiscoverySkillContent,
  DiscoverySnapshot,
  DiscoveryWarning,
} from './types';

export interface LegacyCommandInfo {
  name: string;
  description?: string;
  source: 'command';
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  subtask?: boolean;
}

export class DiscoveryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

export interface DiscoveryServiceDeps {
  getRuntime(): AgentRuntime | null;
  getMafwCommands(): MafwCommandDef[];
  resolveDirectory(sessionID: string, provided?: string): Promise<string | null>;
  broadcast(event: { type: string; sessionID?: string; properties?: unknown }): void;
  gatewayProjectDir: string;
  mafwDir: string;
  homeDir: string;
  globalConfigDir: string;
  now?: () => number;
  ttlMs?: number;
  degradedTtlMs?: number;
  discoverAgents?: typeof discoverAgentsFiles;
}

interface BaseSnapshot {
  directory: string;
  revision: string;
  commandsRevision: string;
  generatedAt: string;
  commands: DiscoveryCommand[];
  skills: DiscoverySkill[];
  instructions: DiscoveryInstruction[];
  degraded: boolean;
  degradedReason?: DiscoveryDegradedReason;
  warnings: DiscoveryWarning[];
  /** True when the runtime skill catalog could not be read (loadSkill -> 503). */
  skillsFailed: boolean;
}

const MAX_SKILL_BYTES = 512 * 1024;

function realOrResolve(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

export class DiscoveryService {
  private cache = new Map<string, { base: BaseSnapshot; expiresAt: number }>();
  private inflight = new Map<string, Promise<BaseSnapshot>>();
  private knownSessions = new Map<string, string>();
  private now: () => number;
  private ttlMs: number;
  private degradedTtlMs: number;
  private gatewayProjectDir: string;

  constructor(private deps: DiscoveryServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? 30_000;
    this.degradedTtlMs = deps.degradedTtlMs ?? 5_000;
    this.gatewayProjectDir = realOrResolve(deps.gatewayProjectDir);
  }

  async get(sessionID: string, opts: { directory?: string; force?: boolean } = {}): Promise<DiscoverySnapshot> {
    const directory = await this.resolveDirectory(sessionID, opts.directory);
    this.knownSessions.set(sessionID, directory);
    const base = await this.baseFor(directory, opts.force === true);
    const { skillsFailed: _skillsFailed, ...publicBase } = base;
    return { ...publicBase, sessionID };
  }

  async refresh(sessionID: string, opts: { directory?: string } = {}): Promise<DiscoverySnapshot> {
    const snap = await this.get(sessionID, { ...opts, force: true });
    this.broadcastSnapshot(sessionID, snap, 'manual_refresh');
    return snap;
  }

  async loadSkill(
    sessionID: string,
    key: string,
    opts: { directory?: string; force?: boolean } = {},
  ): Promise<DiscoverySkillContent> {
    const directory = await this.resolveDirectory(sessionID, opts.directory);
    this.knownSessions.set(sessionID, directory);
    const base = await this.baseFor(directory, opts.force === true);
    const rt = this.deps.getRuntime();
    if (!rt?.capabilities?.discoveryApi || !rt.discovery?.loadSkill || base.skillsFailed) {
      throw new DiscoveryError(503, 'skill catalog unavailable');
    }

    const byId = base.skills.find((s) => s.id === key);
    let skill = byId;
    if (!skill) {
      const matches = base.skills.filter((s) => s.name === key);
      if (matches.length > 1) throw new DiscoveryError(409, 'ambiguous skill name; use id');
      skill = matches[0];
    }
    if (!skill) throw new DiscoveryError(404, `skill not found: ${key}`);
    let loaded;
    try {
      loaded = await rt.discovery.loadSkill({ directory, key });
    } catch {
      throw new DiscoveryError(503, 'skill catalog unavailable');
    }
    if (!loaded) throw new DiscoveryError(404, `skill not found: ${key}`);
    if (Buffer.byteLength(loaded.content, 'utf8') > MAX_SKILL_BYTES) {
      throw new DiscoveryError(413, 'skill content too large');
    }
    return { ...skill, content: loaded.content };
  }

  async getLegacyCommands(
    directory?: string,
    opts: { force?: boolean } = {},
  ): Promise<{ commands: LegacyCommandInfo[]; location: { directory: string }; warnings: DiscoveryWarning[] }> {
    const dir = await this.resolveDefaultDirectory(directory);
    const base = await this.baseFor(dir, opts.force === true);
    const mafwNames = new Set<string>();
    try {
      for (const def of this.deps.getMafwCommands()) {
        mafwNames.add(def.name.toLowerCase());
        for (const alias of def.aliases ?? []) mafwNames.add(alias.toLowerCase());
      }
    } catch { /* warning already surfaced by buildBase */ }
    const commands = base.commands
      .filter((c) => c.source === 'runtime' && !mafwNames.has(c.name.toLowerCase()))
      .map((c): LegacyCommandInfo => ({
        name: c.name,
        ...(c.description ? { description: c.description } : {}),
        source: 'command',
        ...(c.agent ? { agent: c.agent } : {}),
        ...(c.model ? { model: c.model } : {}),
        ...(c.subtask !== undefined ? { subtask: c.subtask } : {}),
      }));
    return { commands, location: { directory: dir }, warnings: base.warnings };
  }

  async getLegacySkills(
    directory?: string,
    opts: { force?: boolean } = {},
  ): Promise<{ skills: DiscoverySkill[]; location: { directory: string }; warnings: DiscoveryWarning[] }> {
    const dir = await this.resolveDefaultDirectory(directory);
    const base = await this.baseFor(dir, opts.force === true);
    return { skills: base.skills, location: { directory: dir }, warnings: base.warnings };
  }

  invalidate(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  forget(sessionID: string): void {
    this.knownSessions.delete(sessionID);
  }

  async broadcastKnown(reason: 'commands_changed' | 'runtime_switched'): Promise<void> {
    for (const [sessionID, directory] of [...this.knownSessions.entries()]) {
      try {
        const snap = await this.get(sessionID, { directory });
        this.broadcastSnapshot(sessionID, snap, reason);
      } catch {
        // Per-session failures never block other sessions.
      }
    }
  }

  private async resolveDirectory(sessionID: string, provided?: string): Promise<string> {
    if (provided !== undefined) return this.validateDirectory(provided);
    let resolved: string | null;
    try {
      resolved = await this.deps.resolveDirectory(sessionID);
    } catch {
      resolved = null;
    }
    if (!resolved) throw new DiscoveryError(404, `session directory not found: ${sessionID}`);
    return this.validateDirectory(resolved);
  }

  private async resolveDefaultDirectory(directory?: string): Promise<string> {
    return this.validateDirectory(directory ?? this.deps.gatewayProjectDir);
  }

  private validateDirectory(directory: string): string {
    if (!path.isAbsolute(directory)) throw new DiscoveryError(400, 'directory must be absolute');
    const resolved = path.resolve(directory);
    try {
      if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
      return fs.realpathSync(resolved);
    } catch {
      throw new DiscoveryError(400, `directory not found: ${directory}`);
    }
  }

  private async baseFor(directory: string, force: boolean): Promise<BaseSnapshot> {
    const cached = this.cache.get(directory);
    if (!force && cached && cached.expiresAt > this.now()) return cached.base;
    if (!force) {
      const running = this.inflight.get(directory);
      if (running) return running;
    }
    const promise = this.buildBase(directory).then((base) => {
      this.cache.set(directory, {
        base,
        expiresAt: this.now() + this.ttlFor(base),
      });
      return base;
    });
    const tracked = promise.finally(() => {
      if (this.inflight.get(directory) === tracked) this.inflight.delete(directory);
    });
    if (!force) this.inflight.set(directory, tracked);
    return tracked;
  }

  private ttlFor(base: BaseSnapshot): number {
    if (base.degradedReason === 'runtime_error' || base.degradedReason === 'partial') {
      return this.degradedTtlMs;
    }
    return this.ttlMs;
  }

  private async buildBase(directory: string): Promise<BaseSnapshot> {
    const warnings: DiscoveryWarning[] = [];
    let degraded = false;
    let degradedReason: DiscoveryDegradedReason | undefined;
    let skillsFailed = false;

    let mafw: MafwCommandDef[] = [];
    try {
      mafw = this.deps.getMafwCommands();
    } catch (err: any) {
      // MAFW registry failure is a warning only; the runtime side may still work.
      warnings.push({ source: 'commands', message: String(err?.message ?? err).slice(0, 300) });
    }

    const rt = this.deps.getRuntime();
    let runtimeCommands: RuntimeCommandInfo[] = [];
    let runtimeSkills: RuntimeSkillInfo[] = [];
    if (rt?.capabilities?.discoveryApi && rt.discovery) {
      try {
        const found = await rt.discovery.list({ directory });
        runtimeCommands = found.commands;
        runtimeSkills = found.skills;
        for (const warning of found.warnings) warnings.push(warning);
        const commandWarn = found.warnings.some((w) => w.source === 'commands');
        const skillWarn = found.warnings.some((w) => w.source === 'skills');
        if (skillWarn) skillsFailed = true;
        if (found.warnings.length > 0) {
          degraded = true;
          degradedReason = found.commands.length === 0 && found.skills.length === 0 && commandWarn && skillWarn
            ? 'runtime_error'
            : 'partial';
        }
      } catch (err: any) {
        degraded = true;
        degradedReason = 'runtime_error';
        skillsFailed = true;
        const message = String(err?.message ?? err).slice(0, 300);
        warnings.push({ source: 'commands', message });
        warnings.push({ source: 'skills', message });
      }
    } else if (rt) {
      degraded = true;
      degradedReason = 'capability_absent';
      skillsFailed = true;
      warnings.push({ source: 'skills', message: 'runtime does not expose discoveryApi' });
    } else {
      degraded = true;
      degradedReason = 'capability_absent';
      skillsFailed = true;
      warnings.push({ source: 'commands', message: 'runtime unavailable' });
    }

    const merged = mergeCommands({
      mafw,
      runtime: runtimeCommands,
      directory,
      gatewayProjectDir: this.gatewayProjectDir,
      mafwDir: this.deps.mafwDir,
    });
    warnings.push(...merged.warnings);

    const skills = mergeSkills(runtimeSkills, {
      directory,
      homeDir: this.deps.homeDir,
      globalConfigDir: this.deps.globalConfigDir,
    });

    let instructions: DiscoveryInstruction[] = [];
    try {
      const found = (this.deps.discoverAgents ?? discoverAgentsFiles)(directory, {
        homeDir: this.deps.homeDir,
        globalConfigDir: this.deps.globalConfigDir,
      });
      instructions = found.instructions;
      warnings.push(...found.warnings);
      if (found.warnings.length > 0 && !degradedReason) {
        degraded = true;
        degradedReason = 'instructions_error';
      }
    } catch (err: any) {
      degraded = true;
      if (!degradedReason) degradedReason = 'instructions_error';
      warnings.push({ source: 'instructions', message: String(err?.message ?? err).slice(0, 300) });
    }

    const revision = computeRevision({ commands: merged.commands, skills, instructions });
    return {
      directory,
      revision: revision.revision,
      commandsRevision: revision.commandsRevision,
      generatedAt: new Date(this.now()).toISOString(),
      commands: merged.commands,
      skills,
      instructions,
      degraded,
      ...(degradedReason ? { degradedReason } : {}),
      warnings,
      skillsFailed,
    };
  }

  private broadcastSnapshot(
    sessionID: string,
    snap: DiscoverySnapshot,
    reason: 'commands_changed' | 'runtime_switched' | 'manual_refresh',
  ): void {
    this.deps.broadcast({
      type: 'session.commands',
      sessionID,
      properties: {
        sessionID,
        directory: snap.directory,
        revision: snap.commandsRevision,
        generatedAt: snap.generatedAt,
        reason,
        commands: snap.commands,
        degraded: snap.degraded,
        warnings: snap.warnings,
      },
    });
  }
}
