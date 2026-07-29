import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const {
  MANAGER_RULE_TEMPLATES,
  ensureManagerRules,
} = require('../../../gateway/src/core/manager/system-rule-templates');

describe('MANAGER_RULE_TEMPLATES', () => {
  it('defines exactly 3 templates', () => {
    expect(Object.keys(MANAGER_RULE_TEMPLATES)).toEqual([
      'manager-report-completed',
      'manager-report-failed',
      'manager-report-question',
    ]);
  });

  it('manager-report-completed has cron trigger and is enabled', () => {
    const t = MANAGER_RULE_TEMPLATES['manager-report-completed'];
    expect(t.enabled).toBe(true);
    expect(t.trigger.type).toBe('cron');
    expect(t.trigger.schedule).toBe('*/5 * * * *');
    expect(t.action.type).toBe('manager:report_completed');
  });

  it('manager-report-failed has event trigger and is enabled', () => {
    const t = MANAGER_RULE_TEMPLATES['manager-report-failed'];
    expect(t.enabled).toBe(true);
    expect(t.trigger.type).toBe('event');
    expect(t.trigger.on).toEqual(['goal.failed']);
    expect(t.trigger.perGoalCooldown).toBe('60s');
    expect(t.action.type).toBe('manager:report_failed');
  });

  it('manager-report-question has event trigger and is disabled', () => {
    const t = MANAGER_RULE_TEMPLATES['manager-report-question'];
    expect(t.enabled).toBe(false);
    expect(t.trigger.type).toBe('event');
    expect(t.trigger.on).toEqual(['goal.awaiting_user']);
    expect(t.trigger.perGoalCooldown).toBe('60s');
    expect(t.action.type).toBe('manager:report_question');
  });
});

describe('ensureManagerRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sys-rules-test-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function autoDir(): string {
    return path.join(tmpDir, 'automations');
  }

  function rulePath(id: string): string {
    return path.join(autoDir(), `${id}.json`);
  }

  it('creates automations directory and writes all 3 templates when none exist', () => {
    ensureManagerRules(tmpDir);

    expect(fs.existsSync(autoDir())).toBe(true);
    for (const id of Object.keys(MANAGER_RULE_TEMPLATES)) {
      expect(fs.existsSync(rulePath(id))).toBe(true);
      const content = JSON.parse(fs.readFileSync(rulePath(id), 'utf-8'));
      expect(content).toEqual(MANAGER_RULE_TEMPLATES[id]);
    }
  });

  it('does not overwrite an existing rule file', () => {
    const completedPath = rulePath('manager-report-completed');
    if (!fs.existsSync(autoDir())) {
      fs.mkdirSync(autoDir(), { recursive: true });
    }
    fs.writeFileSync(completedPath, JSON.stringify({ id: 'manager-report-completed', custom: true }), 'utf-8');

    ensureManagerRules(tmpDir);

    const content = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    expect(content.custom).toBe(true);
  });

  it('keeps user-enabled rule when template has different enabled value', () => {
    const questionPath = rulePath('manager-report-question');
    if (!fs.existsSync(autoDir())) {
      fs.mkdirSync(autoDir(), { recursive: true });
    }
    fs.writeFileSync(
      questionPath,
      JSON.stringify({ ...MANAGER_RULE_TEMPLATES['manager-report-question'], enabled: true }),
      'utf-8',
    );

    ensureManagerRules(tmpDir);

    const content = JSON.parse(fs.readFileSync(questionPath, 'utf-8'));
    expect(content.enabled).toBe(true);
  });

  it('overwrites corrupt rule file', () => {
    const failedPath = rulePath('manager-report-failed');
    if (!fs.existsSync(autoDir())) {
      fs.mkdirSync(autoDir(), { recursive: true });
    }
    fs.writeFileSync(failedPath, 'not valid json', 'utf-8');

    ensureManagerRules(tmpDir);

    const content = JSON.parse(fs.readFileSync(failedPath, 'utf-8'));
    expect(content).toEqual(MANAGER_RULE_TEMPLATES['manager-report-failed']);
  });

  it('creates only missing rules when some exist', () => {
    const completedPath = rulePath('manager-report-completed');
    if (!fs.existsSync(autoDir())) {
      fs.mkdirSync(autoDir(), { recursive: true });
    }
    fs.writeFileSync(completedPath, JSON.stringify(MANAGER_RULE_TEMPLATES['manager-report-completed']), 'utf-8');

    ensureManagerRules(tmpDir);

    expect(fs.existsSync(rulePath('manager-report-failed'))).toBe(true);
    expect(fs.existsSync(rulePath('manager-report-question'))).toBe(true);
  });
});
