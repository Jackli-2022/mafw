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

export const MANAGER_RULE_TEMPLATES: Record<string, SystemRuleTemplate> = {
  'manager-report-completed': {
    id: 'manager-report-completed',
    enabled: true,
    trigger: { type: 'cron', schedule: '*/5 * * * *', timezone: 'UTC' },
    action: { type: 'manager:report_completed' },
  },
  'manager-report-failed': {
    id: 'manager-report-failed',
    enabled: true,
    trigger: { type: 'event', on: ['goal.failed'], perGoalCooldown: '60s' },
    action: { type: 'manager:report_failed' },
  },
  'manager-report-question': {
    id: 'manager-report-question',
    enabled: false,
    trigger: { type: 'event', on: ['goal.awaiting_user'], perGoalCooldown: '60s' },
    action: { type: 'manager:report_question' },
  },
};

export function ensureManagerRules(mafwDir: string): void {
  const autoDir = path.join(mafwDir, 'automations');
  if (!fs.existsSync(autoDir)) {
    fs.mkdirSync(autoDir, { recursive: true });
  }
  for (const [id, template] of Object.entries(MANAGER_RULE_TEMPLATES)) {
    const rulePath = path.join(autoDir, `${id}.json`);
    if (!fs.existsSync(rulePath)) {
      fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8');
      console.log(`[Scheduler] Created system rule: ${id}`);
    } else {
      try {
        const existing = JSON.parse(fs.readFileSync(rulePath, 'utf-8'));
        if (existing.enabled !== template.enabled) {
          console.log(
            `[Scheduler] Rule ${id} exists with user override (enabled: ${existing.enabled}) — keeping user value`,
          );
        }
      } catch {
        fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8');
      }
    }
  }
}
