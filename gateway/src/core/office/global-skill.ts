/**
 * Global Office skill installation (2026-10-31).
 *
 * opencode discovers skills from `<config>/opencode/skills/<name>/SKILL.md` at
 * startup. The gateway ships `skills/office-editing/SKILL.md` and installs it
 * here before spawning serve, so every project gets the capability without a
 * per-repo copy. Idempotent + fail-open.
 *
 * The atomic write/rename mechanics live in `core/skills/global-skill.ts`; this
 * module only pins the skill name so its public API stays unchanged.
 */
import { ensureGlobalSkill, globalSkillTarget, type EnsureSkillResult } from '../skills/global-skill';

export type { EnsureSkillResult } from '../skills/global-skill';

const SKILL_NAME = 'office-editing';

export function officeSkillTarget(skillsDir?: string): string {
  return globalSkillTarget(SKILL_NAME, skillsDir);
}

export async function ensureGlobalOfficeSkill(opts: {
  sourceRoot?: string;
  skillsDir?: string;
  /** Test/override: exact source file. */
  sourceFile?: string;
} = {}): Promise<EnsureSkillResult> {
  return ensureGlobalSkill({ skillName: SKILL_NAME, ...opts });
}
