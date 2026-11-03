/**
 * Global installation of the shipped `plugin-creator` skill (2026-11-03).
 *
 * The Creator identity requires this skill before the first inspect/write; if
 * the skill catalog does not contain it, the identity must stop rather than
 * invent an API. Installed beside the Office skill before serve startup.
 */
import {
  ensureGlobalSkill,
  globalSkillTarget,
  type EnsureSkillResult,
} from '../core/skills/global-skill';

export const PLUGIN_CREATOR_SKILL_NAME = 'plugin-creator';

export function pluginCreatorSkillTarget(skillsDir?: string): string {
  return globalSkillTarget(PLUGIN_CREATOR_SKILL_NAME, skillsDir);
}

export async function ensurePluginCreatorSkill(opts: {
  sourceRoot?: string;
  skillsDir?: string;
  /** Test/override: exact source file. */
  sourceFile?: string;
} = {}): Promise<EnsureSkillResult> {
  return ensureGlobalSkill({ skillName: PLUGIN_CREATOR_SKILL_NAME, ...opts });
}
