// gateway/src/core/goal/starter.ts
// starter 目录解析——goal_created 后定位目标项目（spec §4）。
export interface ProjectEntry { projectDir: string; mafwDir: string }

export function resolveGoalDir(
  projects: ProjectEntry[],
  hintProjectDir?: string,
  hasRequest?: (mafwDir: string) => boolean,
): ProjectEntry | null {
  if (hintProjectDir) {
    const hit = projects.find((p) => p.projectDir === hintProjectDir);
    if (hit) return hit;
  }
  if (hasRequest) {
    const byRequest = projects.find((p) => hasRequest(p.mafwDir));
    if (byRequest) return byRequest;
  }
  return projects[0] ?? null;
}
