import { log } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface SystemRuleTemplate {
  id: string;
  enabled: boolean;
  trigger:
    | { type: 'cron'; schedule: string; timezone: string }
    | { type: 'event'; on: string[]; perGoalCooldown: string };
  action: { type: `manager:${string}` };
}

// Manager milestone notifications moved to MilestonePushNotifier
// (core/manager/milestone-push.ts) — the cron/event wake rules were dead code
// (legacy manager-session.json path, un-emitted events, unwritten reportedAt).
export const MANAGER_RULE_TEMPLATES: Record<string, SystemRuleTemplate> = {};

export const RETIRED_RULE_IDS = ['manager-report-completed', 'manager-report-failed', 'manager-report-question'];

export function ensureManagerRules(mafwDir: string): void {
  const autoDir = path.join(mafwDir, 'automations');
  if (!fs.existsSync(autoDir)) {
    fs.mkdirSync(autoDir, { recursive: true });
  }
  for (const id of RETIRED_RULE_IDS) {
    const rulePath = path.join(autoDir, `${id}.json`);
    if (fs.existsSync(rulePath)) {
      fs.rmSync(rulePath);
      log.info(`[Scheduler] Retired dead rule: ${id}`);
    }
  }
  for (const [id, template] of Object.entries(MANAGER_RULE_TEMPLATES)) {
    const rulePath = path.join(autoDir, `${id}.json`);
    if (!fs.existsSync(rulePath)) {
      fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8');
      log.info(`[Scheduler] Created system rule: ${id}`);
    } else {
      try {
        const existing = JSON.parse(fs.readFileSync(rulePath, 'utf-8'));
        if (existing.enabled !== template.enabled) {
          log.info(
            `[Scheduler] Rule ${id} exists with user override (enabled: ${existing.enabled}) —keeping user value`,
          );
        }
      } catch {
        fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8');
      }
    }
  }
}



