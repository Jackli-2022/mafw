// Canonical Goal identity: a goal id is only meaningful together with its
// project. Resolution never falls back to a registered project chosen by
// insertion order.
import * as fs from 'fs';
import * as path from 'path';
import { canonicalProjectDir } from '../pod/pod-identity';
import { findGoalRequestPath } from './goal-intake';

export interface GoalRef {
  projectDir: string;
  goalId: string;
}

export interface GoalProjectEntry {
  projectDir: string;
  mafwDir: string;
}

export type GoalResolution =
  | { ok: true; ref: GoalRef; mafwDir: string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: string[] };

const SAFE_GOAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function pathKey(value: string): string {
  const canonical = canonicalProjectDir(value);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isSafeGoalId(goalId: string): boolean {
  return SAFE_GOAL_ID.test(goalId) && !goalId.includes('..');
}

function hasGoalFiles(entry: GoalProjectEntry, goalId: string): boolean {
  if (fs.existsSync(path.join(entry.mafwDir, 'state', `${goalId}.json`))) return true;
  return !!findGoalRequestPath(entry.mafwDir, goalId);
}

/**
 * Resolve from explicit registered-project entries. The index uses this form
 * because registered projects can carry a mafwDir that is not the conventional
 * `<project>/.mafw`.
 */
export function resolveGoalRefFromEntries(
  entries: readonly GoalProjectEntry[],
  goalId: string,
  opts?: { projectDir?: string },
): GoalResolution {
  if (!isSafeGoalId(goalId)) return { ok: false, reason: 'not_found', candidates: [] };

  let candidates = entries
    .map((entry) => ({
      projectDir: canonicalProjectDir(entry.projectDir),
      mafwDir: path.resolve(entry.mafwDir),
    }))
    .filter((entry) => hasGoalFiles(entry, goalId));

  if (opts?.projectDir) {
    const wanted = pathKey(opts.projectDir);
    candidates = candidates.filter((entry) => pathKey(entry.projectDir) === wanted);
  }

  candidates.sort((a, b) => a.projectDir.localeCompare(b.projectDir));

  if (candidates.length === 1) {
    const hit = candidates[0];
    return { ok: true, ref: { projectDir: hit.projectDir, goalId }, mafwDir: hit.mafwDir };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: candidates.map((entry) => entry.projectDir),
    };
  }
  return { ok: false, reason: 'not_found', candidates: [] };
}

/** Convenience form for callers that only know registered project dirs. */
export function resolveGoalRef(
  projects: readonly string[],
  goalId: string,
  opts?: { projectDir?: string },
): GoalResolution {
  return resolveGoalRefFromEntries(
    projects.map((projectDir) => ({
      projectDir,
      mafwDir: path.join(projectDir, '.mafw'),
    })),
    goalId,
    opts,
  );
}
