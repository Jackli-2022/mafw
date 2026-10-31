/**
 * Global Office skill installation (2026-10-31).
 *
 * opencode discovers skills from `<config>/opencode/skills/<name>/SKILL.md` at
 * startup. The gateway ships `skills/office-editing/SKILL.md` and installs it
 * here before spawning serve, so every project gets the capability without a
 * per-repo copy. Idempotent + fail-open.
 */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type EnsureSkillResult =
  | { ok: true; action: 'installed' | 'updated' | 'unchanged'; target: string }
  | { ok: false; reason: 'source-missing' | 'io'; target: string };

const SKILL_NAME = 'office-editing';

/** Package root: <root>/gateway/dist/core/office → <root> (same depth in src). */
function defaultSourceRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function officeSkillTarget(skillsDir?: string): string {
  const base = skillsDir
    || process.env.MAFW_OPENCODE_SKILLS_DIR
    || path.join(os.homedir(), '.config', 'opencode', 'skills');
  return path.join(base, SKILL_NAME, 'SKILL.md');
}

export async function ensureGlobalOfficeSkill(opts: {
  sourceRoot?: string;
  skillsDir?: string;
  /** Test/override: exact source file. */
  sourceFile?: string;
} = {}): Promise<EnsureSkillResult> {
  const source = opts.sourceFile
    || path.join(opts.sourceRoot ?? defaultSourceRoot(), 'skills', SKILL_NAME, 'SKILL.md');
  const target = officeSkillTarget(opts.skillsDir);
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
