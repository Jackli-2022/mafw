// Idempotent provisioning of the memory-pipeline cron rules
// (turn-compress hourly, memory-reflect daily). Fresh installs otherwise have
// no rules and the pipelines never run.
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';

const RULES: Array<{ id: string; schedule: string; timezone: string; action: string }> = [
  { id: 'turn-compress', schedule: '0 * * * *', timezone: 'UTC', action: 'memory:turnCompress' },
  { id: 'memory-reflect', schedule: '0 3 * * *', timezone: 'UTC', action: 'memory:reflect' },
  // Daily energy decay — memories fade by elapsed time (0.005/day base rate).
  { id: 'memory-decay', schedule: '30 3 * * *', timezone: 'UTC', action: 'memory:decay' },
  // Weekly stale-memory verification — the curator re-checks high-value
  // procedural/semantic memories against the live environment (read-only
  // probes) and supersedes contradicted ones (env-probing curation).
  { id: 'memory-review', schedule: '0 4 * * 0', timezone: 'UTC', action: 'memory:review' },
  // D2: daily reconsolidation sweep — mutated (labile) memories are checked
  // against newer related memories; contradicted ones get an update via the
  // supersedes chain. Runs after decay (3:30) so energy is settled.
  { id: 'memory-reconsolidate', schedule: '30 4 * * *', timezone: 'UTC', action: 'memory:reconsolidate' },
  // D4a: nightly dream prefetch — generate the most likely next-session queries
  // per recently-active session; the first user input of the day prefetches them.
  { id: 'memory-dream', schedule: '0 2 * * *', timezone: 'UTC', action: 'memory:dream' },
  // Weekly skill promotion (W2) — procedural memories that pass G1-G5 are
  // rendered to staged SKILL.md drafts + triage items for human approval.
  { id: 'skill-promotion', schedule: '0 5 * * 0', timezone: 'UTC', action: 'memory:skillPromotion' },
];

export function ensureMemoryPipelineRules(mafwDir: string): void {
  const dir = path.join(mafwDir, 'automations');
  for (const rule of RULES) {
    const file = path.join(dir, `${rule.id}.json`);
    if (fs.existsSync(file)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            id: rule.id,
            enabled: true,
            trigger: { type: 'cron', schedule: rule.schedule, timezone: rule.timezone },
            action: { type: rule.action },
            skill: '',
            args: {},
            onResult: { type: 'goal' },
          },
          null,
          2,
        ),
        'utf-8',
      );
      log.info(`[Scheduler] provisioned pipeline rule ${rule.id}`);
    } catch (err: any) {
      log.warn(`[Scheduler] failed to provision rule ${rule.id}: ${err.message}`);
    }
  }
}
