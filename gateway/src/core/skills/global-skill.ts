/**
 * Generic global skill installation (2026-11-03).
 *
 * opencode discovers skills from `<config>/opencode/skills/<name>/SKILL.md` at
 * startup. The gateway ships skills under `<repo>/skills/` and installs them
 * here before spawning serve, so every project gets the capability without a
 * per-repo copy. Idempotent + fail-open.
 *
 * Extracted from the Office installer so each shipped skill reuses the same
 * atomic write/rename path (a half-written SKILL.md must never be discovered).
 */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type EnsureSkillResult =
  | { ok: true; action: 'installed' | 'updated' | 'unchanged'; target: string }
  | { ok: false; reason: 'source-missing' | 'io'; target: string };

/** User-level opencode skills directory (overridable for tests/packaging). */
export function defaultSkillsDir(): string {
  return process.env.MAFW_OPENCODE_SKILLS_DIR
    || path.join(os.homedir(), '.config', 'opencode', 'skills');
}

/** `<skillsDir>/<skillName>/SKILL.md` */
export function globalSkillTarget(skillName: string, skillsDir?: string): string {
  return path.join(skillsDir || defaultSkillsDir(), skillName, 'SKILL.md');
}

/** Package root: <root>/gateway/dist/core/skills → <root> (same depth in src). */
function defaultSourceRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export async function ensureGlobalSkill(opts: {
  skillName: string;
  sourceRoot?: string;
  skillsDir?: string;
  /** Test/override: exact source file. */
  sourceFile?: string;
}): Promise<EnsureSkillResult> {
  const source = opts.sourceFile
    || path.join(opts.sourceRoot ?? defaultSourceRoot(), 'skills', opts.skillName, 'SKILL.md');
  const target = globalSkillTarget(opts.skillName, opts.skillsDir);
  let content: string;
  try {
    content = await fs.readFile(source, 'utf8');
  } catch {
    return { ok: false, reason: 'source-missing', target };
  }
  try {
    const existing = await fs.readFile(target, 'utf8').catch(() => null);
    if (existing === content) return { ok: true, action: 'unchanged', target };
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, target);
    return { ok: true, action: existing === null ? 'installed' : 'updated', target };
  } catch {
    return { ok: false, reason: 'io', target };
  }
}
