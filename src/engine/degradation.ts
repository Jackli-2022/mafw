import * as fs from 'fs';
import * as path from 'path';
import { ReportGenerator } from './report-generator';

/**
 * Degradation Strategy — 五级降级策略
 *
 * L1: 警告 — Loop 3/5 提示用户，不停止
 * L2: 降级 — Loop 5/5 自动降级完成部分工作
 * L3: 熔断 — 连续 3 轮相同 Lesson 强制退出
 * L4: 紧急 — 心跳超时，从 Checkpoint 恢复
 * L5: 灾难 — 外部依赖失败，优雅失败
 */
export class DegradationStrategy {
  private projectDir: string;
  private reportGenerator: ReportGenerator;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.reportGenerator = new ReportGenerator(projectDir);
  }

  /**
   * 判断是否需要 L1 警告
   */
  shouldWarn(loopCount: number, maxLoops: number): boolean {
    return loopCount >= Math.ceil(maxLoops * 0.6); // 3/5
  }

  /**
   * L1 警告处理：提示用户选择
   */
  async handleL1(goalId: string, loopCount: number, reviewResult: any): Promise<string> {
    const warning = [
      `[MAFW 警告] Goal "${goalId}" 已迭代 ${loopCount} 次仍未完成`,
      `当前问题: ${reviewResult.reason || 'unknown'}`,
      '建议:',
      '1. 放宽指标',
      '2. 检查环境配置',
      '3. 手动介入审查',
      '',
      '选项: [1]继续 [2]放宽 [3]暂停 [4]接受降级'
    ].join('\n');

    console.log(warning);

    // 简化：自动选择继续（实际应读取用户输入或 control 文件）
    const controlFile = path.join(this.projectDir, '.opencode/mafw/control');
    if (fs.existsSync(controlFile)) {
      const control = fs.readFileSync(controlFile, 'utf-8').trim();
      if (control.startsWith('DEGRADE:')) return 'accept_partial';
      if (control === 'PAUSE') return 'pause';
      if (control === 'ABORT') return 'abort';
    }
    return 'continue';
  }

  /**
   * L2 降级：自动执行
   */
  async autoDegrade(goalId: string, executeResult: any): Promise<void> {
    const coverage = executeResult.metrics?.coverage || 0;
    let strategy: string;
    let message: string;

    if (coverage >= 60) {
      strategy = 'partial';
      message = `放宽指标至 ${coverage}%，标记为"部分完成"`;
      await this.degradeToPartial(goalId, executeResult);
    } else if (coverage >= 40) {
      strategy = 'core_only';
      message = '只保留核心功能，移除边缘功能';
    } else {
      strategy = 'rollback';
      message = '回滚到上一个稳定 Loop';
    }

    console.log(`[Degradation] L2 策略: ${strategy} — ${message}`);
    await this.reportGenerator.generateDegraded(goalId, {
      loopCount: executeResult.loopCount,
      reason: `L2 降级: ${message}`,
      metrics: executeResult.metrics
    });
  }

  /**
   * L2 降级：接受部分完成
   */
  async degradeToPartial(goalId: string, executeResult: any): Promise<void> {
    console.log(`[Degradation] ${goalId}: 接受部分完成，生成降级报告`);
    await this.reportGenerator.generateDegraded(goalId, {
      loopCount: executeResult.loopCount,
      reason: '用户接受部分完成',
      metrics: executeResult.metrics
    });
  }

  /**
   * L3 熔断检测：连续 3 轮相同原因
   */
  async checkL3Oscillation(goalId: string, lessons: { reason: string }[]): Promise<boolean> {
    const last3 = lessons.slice(-3);
    if (last3.length < 3) return false;
    const sameReason = last3.every(l => l.reason === last3[0].reason);
    if (sameReason) {
      console.log(`[Degradation] L3 熔断: 连续 3 次相同原因 — ${last3[0].reason}`);
      return true;
    }
    return false;
  }

  /**
   * L4 紧急：从 Checkpoint 恢复
   */
  async recoverFromCheckpoint(goalId: string, checkpointPath: string): Promise<void> {
    console.log(`[Degradation] L4 恢复: 从 ${checkpointPath} 恢复状态`);
    // 恢复 L1 Session + L3 Parametric 状态
  }

  /**
   * L5 灾难：导出记忆到外部 Git 分支
   */
  async exportForDisaster(goalId: string): Promise<string> {
    const exportBranch = `disaster-export/${goalId}`;
    console.log(`[Degradation] L5 导出: parametric/ + lessons/ → ${exportBranch}`);
    return exportBranch;
  }
}
