/**
 * Automation Engine — Gateway 子模块
 *
 * 职责：
 *   1. 读取 automations/*.json 规则
 *   2. 注册 Cron 定时器
 *   3. 触发 Skill 执行发现
 *   4. 处理结果 → Triage 或 Goal
 *
 * 核心原则：只发现工作，不执行工作
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AutomationRule {
  id: string;
  enabled: boolean;
  trigger: {
    type: 'cron';
    schedule: string;
    timezone: string;
  };
  skill: string;
  args: Record<string, any>;
  onResult: {
    type: 'triage' | 'goal';
    auto_confirm?: boolean;
    template?: string;
  };
  goal_defaults?: {
    maxLoops?: number;
    metrics?: Record<string, { target: number; unit: string }>;
  };
}

export class AutomationEngine {
  private rules: Map<string, AutomationRule> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private mafwDir: string;

  constructor(mafwDir: string) {
    this.mafwDir = mafwDir;
  }

  /**
   * 加载所有自动化规则
   */
  loadRules(): void {
    const autoDir = path.join(this.mafwDir, 'automations');
    if (!fs.existsSync(autoDir)) return;

    const files = fs.readdirSync(autoDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const rule: AutomationRule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
        if (rule.enabled) {
          this.rules.set(rule.id, rule);
        }
      } catch (err: any) {
        console.warn(`[AutomationEngine] Failed to load rule ${file}: ${err.message}`);
      }
    }

    console.log(`[AutomationEngine] Loaded ${this.rules.size} automation rules`);
  }

  /**
   * 启动所有定时器
   */
  start(): void {
    for (const [id, rule] of this.rules) {
      this.scheduleRule(id, rule);
    }
  }

  /**
   * 停止所有定时器
   */
  stop(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /**
   * 调度单个规则
   */
  private scheduleRule(id: string, rule: AutomationRule): void {
    // 简化实现：使用 setTimeout 模拟 cron
    // 实际实现应使用 node-cron 库
    console.log(`[AutomationEngine] Scheduled rule ${id}: ${rule.trigger.schedule}`);
  }

  /**
   * 执行规则（触发 Skill）
   */
  async executeRule(id: string): Promise<void> {
    const rule = this.rules.get(id);
    if (!rule) {
      console.warn(`[AutomationEngine] Rule not found: ${id}`);
      return;
    }

    console.log(`[AutomationEngine] Executing rule ${id}: ${rule.skill}`);

    // 创建 Triage 或 Goal
    if (rule.onResult.type === 'triage') {
      await this.createTriage(id, rule);
    } else {
      await this.createGoal(id, rule);
    }
  }

  /**
   * 创建 Triage 项
   */
  private async createTriage(automationId: string, rule: AutomationRule): Promise<void> {
    const triageDir = path.join(this.mafwDir, 'triage');
    if (!fs.existsSync(triageDir)) fs.mkdirSync(triageDir, { recursive: true });

    const triageId = `triage-${Date.now()}`;
    const triageFile = path.join(triageDir, `${triageId}.json`);

    fs.writeFileSync(triageFile, JSON.stringify({
      id: triageId,
      automationId,
      discoveredAt: new Date().toISOString(),
      source: rule.skill,
      summary: {},
      proposedGoal: {
        title: rule.onResult.template || `Automation: ${rule.id}`,
        boundaries: [],
        estimatedLoops: rule.goal_defaults?.maxLoops || 3
      },
      state: 'PENDING_CONFIRMATION',
      userAction: null,
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }, null, 2));

    console.log(`[AutomationEngine] Created triage: ${triageId}`);
  }

  /**
   * 创建 Goal（直接执行，无需 Triage）
   */
  private async createGoal(automationId: string, rule: AutomationRule): Promise<void> {
    // 直接写入 requests/ 和 state/
    console.log(`[AutomationEngine] Direct goal creation not yet implemented for ${automationId}`);
  }
}
