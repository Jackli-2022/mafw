// Dry-run by default: import historical Goals into Pod read models only when
// request.json itself proves the owning project. Pass --apply explicitly.
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { config } from '../src/config';
import { PodStore } from '../src/core/pod/pod-store';
import { canonicalProjectDir, podIdForProject } from '../src/core/pod/pod-identity';
import {
  applyPodGoalBackfill,
  planPodGoalBackfill,
} from '../src/core/pod/pod-goal-backfill';

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const projects = args.filter((arg) => !arg.startsWith('--')).map((arg) => path.resolve(arg));
  if (projects.length === 0) {
    projects.push(path.resolve(process.env.MAFW_PROJECT_DIR || process.cwd()));
  }

  if (!apply) {
    const report = planPodGoalBackfill(projects);
    console.log(JSON.stringify({
      mode: 'dry-run',
      projects,
      eligible: report.eligible.length,
      skipped: report.skipped,
      goals: report.eligible,
    }, null, 2));
    return;
  }

  const dbPath = config.resolvePath('memory', 'gateway.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const store = new PodStore(db);
  try {
    const report = planPodGoalBackfill(projects, {
      existingGoal: (ref) => {
        const projectDir = canonicalProjectDir(ref.projectDir);
        const pod = store.getPodByProject(projectDir);
        return !!(pod && store.getGoal(pod.id, ref.goalId));
      },
    });
    const result = applyPodGoalBackfill(report, {
      store,
      now: () => new Date().toISOString(),
      newId: () => `podgoal_${randomUUID()}`,
    });
    console.log(JSON.stringify({
      mode: 'apply',
      projects,
      applied: result.applied,
      alreadyPresent: result.alreadyPresent,
      skipped: report.skipped,
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
