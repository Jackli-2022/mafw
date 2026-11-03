// Historical Goal backfill. Import is allowed only when the request itself
// proves project ownership; a goal id that appears in two projects is never
// resolved by registration order.
import * as fs from 'fs';
import * as path from 'path';
import type { PodStore } from './pod-store';
import { canonicalProjectDir, podIdForProject } from './pod-identity';
import { findGoalRequestPath, readGoalRequest } from '../goal/goal-intake';
import type { GoalRef } from '../goal/goal-identity';
import { isTerminalState, loadGoalState, statePathFor } from '../goal/state-v3';

export interface PodGoalBackfillReport {
  eligible: GoalRef[];
  skipped: Array<{ goalId: string; reason: 'ambiguous' | 'unprovable' | 'already_present' }>;
}

export interface PodGoalBackfillPlanOptions {
  existingGoal?: (ref: GoalRef) => boolean;
}

export interface PodGoalBackfillApplyDeps {
  store: PodStore;
  now(): string;
  newId(): string;
}

export interface PodGoalBackfillApplyResult {
  applied: GoalRef[];
  alreadyPresent: GoalRef[];
}

const SAFE_GOAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sameProject(a: string, b: string): boolean {
  return canonicalProjectDir(a) === canonicalProjectDir(b);
}

function readJson(filePath: string): Record<string, any> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function collectGoalIds(mafwDir: string): Set<string> {
  const ids = new Set<string>();
  const addJsonNames = (dir: string, fileName?: (name: string) => string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const goalId = fileName ? fileName(name) : name.replace(/\.json$/, '');
      if (SAFE_GOAL_ID.test(goalId) && !goalId.includes('..')) ids.add(goalId);
    }
  };
  addJsonNames(path.join(mafwDir, 'state'));
  addJsonNames(path.join(mafwDir, 'requests'), (name) => name.endsWith('.json') ? name.slice(0, -5) : '');
  const goalsDir = path.join(mafwDir, 'goals');
  if (fs.existsSync(goalsDir)) {
    for (const entry of fs.readdirSync(goalsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!SAFE_GOAL_ID.test(entry.name) || entry.name.includes('..')) continue;
      if (fs.existsSync(path.join(goalsDir, entry.name, 'request.json'))) ids.add(entry.name);
    }
  }
  return ids;
}

function validateCandidate(projectDir: string, goalId: string): GoalRef | null {
  const canonical = canonicalProjectDir(projectDir);
  const mafwDir = path.join(canonical, '.mafw');
  if (!findGoalRequestPath(mafwDir, goalId)) return null;
  const request = readGoalRequest(mafwDir, goalId);
  const requestProject = typeof request?.projectDir === 'string' ? request.projectDir : '';
  if (!requestProject || !sameProject(requestProject, canonical)) return null;

  const statePath = statePathFor(mafwDir, goalId);
  if (fs.existsSync(statePath)) {
    const raw = readJson(statePath);
    if (!raw) return null;
    if (typeof raw.projectDir === 'string' && raw.projectDir && !sameProject(raw.projectDir, canonical)) {
      return null;
    }
  }
  return { projectDir: canonical, goalId };
}

export function planPodGoalBackfill(
  projects: readonly string[],
  opts: PodGoalBackfillPlanOptions = {},
): PodGoalBackfillReport {
  const candidates = new Map<string, GoalRef[]>();
  const skipped: PodGoalBackfillReport['skipped'] = [];
  const seenUnprovable = new Set<string>();

  for (const projectDir of projects) {
    const canonical = canonicalProjectDir(projectDir);
    const mafwDir = path.join(canonical, '.mafw');
    for (const goalId of collectGoalIds(mafwDir)) {
      const valid = validateCandidate(canonical, goalId);
      if (!valid) {
        const key = `${canonical}\0${goalId}`;
        if (!seenUnprovable.has(key)) {
          seenUnprovable.add(key);
          skipped.push({ goalId, reason: 'unprovable' });
        }
        continue;
      }
      const list = candidates.get(goalId) ?? [];
      list.push(valid);
      candidates.set(goalId, list);
    }
  }

  const eligible: GoalRef[] = [];
  for (const [goalId, refs] of [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (refs.length > 1) {
      skipped.push({ goalId, reason: 'ambiguous' });
      continue;
    }
    const ref = refs[0];
    if (opts.existingGoal?.(ref)) {
      skipped.push({ goalId, reason: 'already_present' });
      continue;
    }
    eligible.push(ref);
  }
  eligible.sort((a, b) => a.projectDir.localeCompare(b.projectDir) || a.goalId.localeCompare(b.goalId));
  skipped.sort((a, b) => a.goalId.localeCompare(b.goalId) || a.reason.localeCompare(b.reason));
  return { eligible, skipped };
}

export function applyPodGoalBackfill(
  report: PodGoalBackfillReport,
  deps: PodGoalBackfillApplyDeps,
): PodGoalBackfillApplyResult {
  const applied: GoalRef[] = [];
  const alreadyPresent: GoalRef[] = [];
  for (const ref of report.eligible) {
    const projectDir = canonicalProjectDir(ref.projectDir);
    const mafwDir = path.join(projectDir, '.mafw');
    const pod = deps.store.ensurePod({
      id: podIdForProject(projectDir),
      projectDir,
      name: path.basename(projectDir) || projectDir,
      now: deps.now(),
    });
    if (deps.store.getGoal(pod.id, ref.goalId)) {
      alreadyPresent.push(ref);
      continue;
    }

    const row = deps.store.enqueueGoal({
      id: deps.newId(),
      podId: pod.id,
      goalId: ref.goalId,
      now: deps.now(),
    });
    const state = loadGoalState(mafwDir, ref.goalId);
    if (state?.nextAction && isTerminalState(state)) {
      deps.store.setGoalStatus(row.id, 'done', {
        endedAt: deps.now(),
        ...(state.reviewVerdict ? { verdict: state.reviewVerdict } : {}),
      });
    } else {
      const request = readGoalRequest(mafwDir, ref.goalId);
      if (request?.discussion === true || !state) {
        deps.store.createGoalRevision({
          podId: pod.id,
          goalId: ref.goalId,
          revision: 1,
          status: 'discussing',
          now: deps.now(),
        });
        deps.store.setGoalStatus(row.id, 'active', { startedAt: deps.now() });
      } else {
        deps.store.setGoalStatus(row.id, 'queued', {});
      }
    }
    applied.push(ref);
  }
  applied.sort((a, b) => a.projectDir.localeCompare(b.projectDir) || a.goalId.localeCompare(b.goalId));
  alreadyPresent.sort((a, b) => a.projectDir.localeCompare(b.projectDir) || a.goalId.localeCompare(b.goalId));
  return { applied, alreadyPresent };
}
