import { createHash } from 'crypto';
import * as path from 'path';
import type { MafwCommandDef } from '../../commands/registry';
import type { RuntimeCommandInfo, RuntimeSkillInfo } from '../../runtime/contract';
import type {
  DiscoveryCommand,
  DiscoveryInstruction,
  DiscoverySkill,
  DiscoveryWarning,
} from './types';

function resolved(p: string): string {
  return path.resolve(p);
}

function comparable(p: string): string {
  const r = resolved(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function isUnder(child: string, parent: string): boolean {
  const c = comparable(child);
  const p = comparable(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function samePath(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

function mafwScope(def: MafwCommandDef, directory: string, gatewayProjectDir: string, mafwDir: string): DiscoveryCommand['scope'] | null {
  if (def.kind === 'builtin') return 'gateway';
  const source = def.source ? resolved(def.source) : '';
  if (source && isUnder(source, path.join(mafwDir, 'commands'))) return 'user';
  if (source && isUnder(source, path.join(gatewayProjectDir, '.mafw', 'commands')) && samePath(directory, gatewayProjectDir)) {
    return 'project';
  }
  return null;
}

/** Merge gateway MAFW commands with runtime commands; runtime fields enrich same-name MAFW entries. */
export function mergeCommands(input: {
  mafw: MafwCommandDef[];
  runtime: RuntimeCommandInfo[];
  directory: string;
  gatewayProjectDir: string;
  mafwDir: string;
}): { commands: DiscoveryCommand[]; warnings: DiscoveryWarning[] } {
  const commands: DiscoveryCommand[] = [];
  const byName = new Map<string, DiscoveryCommand>();
  let omittedCustom = false;

  for (const def of input.mafw) {
    const scope = mafwScope(def, input.directory, input.gatewayProjectDir, input.mafwDir);
    if (!scope) {
      omittedCustom = true;
      continue;
    }
    const command: DiscoveryCommand = {
      name: def.name,
      ...(def.aliases?.length ? { aliases: [...def.aliases] } : {}),
      description: def.description,
      ...(def.argumentHint ? { argumentHint: def.argumentHint } : {}),
      ...(def.category ? { category: def.category } : {}),
      ...(def.destructive ? { destructive: true } : {}),
      source: def.kind === 'builtin' ? 'mafw' : 'custom',
      scope,
    };
    commands.push(command);
    byName.set(def.name.toLowerCase(), command);
    for (const alias of def.aliases ?? []) byName.set(alias.toLowerCase(), command);
  }

  for (const runtime of input.runtime) {
    if (!runtime?.name) continue;
    const existing = byName.get(runtime.name.toLowerCase());
    if (existing) {
      existing.runtime = true;
      if (runtime.agent) existing.agent = runtime.agent;
      if (runtime.model) existing.model = runtime.model;
      if (runtime.subtask !== undefined) existing.subtask = runtime.subtask;
      continue;
    }
    const command: DiscoveryCommand = {
      name: runtime.name,
      ...(runtime.description ? { description: runtime.description } : { description: '' }),
      ...(runtime.agent ? { agent: runtime.agent } : {}),
      ...(runtime.model ? { model: runtime.model } : {}),
      ...(runtime.subtask !== undefined ? { subtask: runtime.subtask } : {}),
      source: 'runtime',
      scope: 'runtime',
      category: 'runtime',
    };
    commands.push(command);
    byName.set(command.name.toLowerCase(), command);
  }

  commands.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));
  return {
    commands,
    warnings: omittedCustom
      ? [{
          source: 'commands',
          message: `project-scoped MAFW commands are not discovered for ${input.directory}`,
        }]
      : [],
  };
}

/** Runtime skills -> discovery metadata; content is reduced to a length. */
export function mergeSkills(
  runtime: RuntimeSkillInfo[],
  opts: { directory: string; homeDir: string; globalConfigDir: string },
): DiscoverySkill[] {
  const byId = new Map<string, DiscoverySkill>();
  for (const skill of runtime) {
    if (!skill?.id) continue;
    if (byId.has(skill.id)) continue;
    const location = skill.location;
    let scope: DiscoverySkill['scope'] = 'path';
    if (location && isUnder(location, opts.directory)) scope = 'project';
    else if (location && (isUnder(location, opts.globalConfigDir) || isUnder(location, path.join(opts.homeDir, '.claude')))) {
      scope = 'user';
    }
    byId.set(skill.id, {
      id: skill.id,
      name: skill.name || skill.id,
      ...(skill.description ? { description: skill.description } : {}),
      slash: !!skill.slash,
      scope,
      ...(location ? { location } : {}),
      contentLength: skill.contentLength,
    });
  }
  const rank: Record<DiscoverySkill['scope'], number> = { user: 0, project: 1, path: 2 };
  return [...byId.values()].sort((a, b) =>
    rank[a.scope] - rank[b.scope] ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    a.name.localeCompare(b.name),
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function computeRevision(input: {
  commands: DiscoveryCommand[];
  skills: DiscoverySkill[];
  instructions: DiscoveryInstruction[];
}): { revision: string; commandsRevision: string } {
  return {
    revision: sha256({ commands: input.commands, skills: input.skills, instructions: input.instructions }),
    commandsRevision: sha256(input.commands),
  };
}
