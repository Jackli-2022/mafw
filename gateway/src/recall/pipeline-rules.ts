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
