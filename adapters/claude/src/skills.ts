import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  RuntimeDiscoveryResult,
  RuntimeDiscoverySkill,
  RuntimeDiscoverySkillContent,
} from '@mafw/runtime-contract';

const MAX_SKILLS = 200;

/** Read `description:` from a SKILL.md / command frontmatter block (best effort). */
function frontmatterDescription(file: string): string | undefined {
  try {
    const head = fs.readFileSync(file, 'utf-8').slice(0, 4096);
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    if (!m) return undefined;
    const line = m[1].split(/\r?\n/).find((l) => /^description\s*:/.test(l));
    if (!line) return undefined;
    return line.replace(/^description\s*:\s*/, '').trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

function walkSkills(root: string, out: Array<{ id: string; file: string }>, depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(full, 'SKILL.md');
    if (fs.existsSync(skillFile)) out.push({ id: entry.name, file: skillFile });
    else walkSkills(full, out, depth + 1);
  }
}

function walkCommands(root: string, out: Array<{ id: string; file: string }>, prefix = '', depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkCommands(full, out, prefix ? `${prefix}:${entry.name}` : entry.name, depth + 1);
    } else if (entry.name.endsWith('.md')) {
      const base = entry.name.replace(/\.md$/, '');
      out.push({ id: prefix ? `${prefix}:${base}` : base, file: full });
    }
  }
}

/**
 * Claude Code skills live in `.claude/skills/<id>/SKILL.md`; commands live in
 * `.claude/commands/` (recursive `.md` files). Project entries override user
 * entries by id.
 */
export function listClaudeSkills(directory: string, homeDir = os.homedir()): RuntimeDiscoverySkill[] {
  const byId = new Map<string, RuntimeDiscoverySkill>();
  const roots = [
    { dir: path.join(homeDir, '.claude', 'skills'), kind: 'skills' as const },
    { dir: path.join(directory, '.claude', 'skills'), kind: 'skills' as const },
    { dir: path.join(homeDir, '.claude', 'commands'), kind: 'commands' as const },
    { dir: path.join(directory, '.claude', 'commands'), kind: 'commands' as const },
  ];
  for (const root of roots) {
    const found: Array<{ id: string; file: string }> = [];
    if (root.kind === 'skills') walkSkills(root.dir, found);
    else walkCommands(root.dir, found);
    for (const item of found) {
      if (byId.size >= MAX_SKILLS) break;
      let contentLength = 0;
      try {
        contentLength = fs.statSync(item.file).size;
      } catch {
        continue;
      }
      const description = frontmatterDescription(item.file);
      byId.set(item.id, {
        id: item.id,
        name: item.id,
        ...(description ? { description } : {}),
        slash: true,
        location: item.file,
        contentLength,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function loadClaudeSkill(
  directory: string,
  key: string,
  homeDir = os.homedir(),
): RuntimeDiscoverySkillContent | null {
  const skill = listClaudeSkills(directory, homeDir).find((s) => s.id === key || s.name === key);
  if (!skill?.location) return null;
  try {
    return { ...skill, content: fs.readFileSync(skill.location, 'utf-8') };
  } catch {
    return null;
  }
}

/** Adapter-owned dialect: Claude Code invokes skills as `/skill-name args`. */
export function createClaudeDiscovery(promptAsync: (sessionID: string, text: string) => Promise<void>) {
  return {
    async list({ directory }: { directory: string }): Promise<RuntimeDiscoveryResult> {
      return { commands: [], skills: listClaudeSkills(directory), warnings: [] };
    },
    async loadSkill({ directory, key }: { directory: string; key: string }) {
      return loadClaudeSkill(directory, key);
    },
    async invokeSkill({ sessionID, key, args }: { sessionID: string; key: string; args: string }) {
      const text = args.trim() ? `/${key} ${args.trim()}` : `/${key}`;
      await promptAsync(sessionID, text);
    },
  };
}
