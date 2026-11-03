// gateway/src/core/goal/starter.ts
// starter 目录解析——goal_created 后定位目标项目（spec §4）。
import { canonicalProjectDir } from '../pod/pod-identity';

export interface ProjectEntry { projectDir: string; mafwDir: string }

function pathKey(value: string): string {
  const canonical = canonicalProjectDir(value);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

export function resolveGoalDir(
  projects: ProjectEntry[],
  hintProjectDir?: string,
  hasRequest?: (mafwDir: string) => boolean,
): ProjectEntry | null {
  const registeredHint = hintProjectDir
    ? projects.find((project) => pathKey(project.projectDir) === pathKey(hintProjectDir!)) ?? null
    : null;

  // A registered hint is an explicit narrowing, not a licence to ignore the
  // filesystem. If a request predicate exists, the hinted project must own it.
  if (registeredHint) {
    return !hasRequest || hasRequest(registeredHint.mafwDir) ? registeredHint : null;
  }

  if (!hasRequest) return null;
  const matches = projects.filter((project) => hasRequest(project.mafwDir));
  return matches.length === 1 ? matches[0] : null;
}
