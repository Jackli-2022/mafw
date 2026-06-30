import * as fs from 'fs';
import * as path from 'path';

/**
 * Recovery — 崩溃恢复器
 *
 * Scheduler 重启后：
 *   1. 读取 STATUS.md，找到所有 RUNNING 状态的 Goal
 *   2. 尝试找到最近的 Checkpoint
 *   3. 重新创建 session 并启动 Loop
 */

export class RecoveryManager {
  private projectDir: string;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
  }

  /**
   * 查找最近的 Checkpoint
   */
  findLastCheckpoint(goalId: string): string | null {
    const checkpointsDir = path.join(this.projectDir, '.opencode/mafw/checkpoints', goalId);
    if (!fs.existsSync(checkpointsDir)) return null;

    const files = fs.readdirSync(checkpointsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    return files.length > 0 ? path.join(checkpointsDir, files[0]) : null;
  }

  /**
   * 保存 Checkpoint
   */
  saveCheckpoint(goalId: string, loop: number, data: any): void {
    const checkpointsDir = path.join(this.projectDir, '.opencode/mafw/checkpoints', goalId);
    if (!fs.existsSync(checkpointsDir)) fs.mkdirSync(checkpointsDir, { recursive: true });

    const checkpointPath = path.join(checkpointsDir, `loop-${loop}.json`);
    const checkpoint = {
      goalId,
      loop,
      timestamp: new Date().toISOString(),
      ...data
    };
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  /**
   * 加载 Checkpoint
   */
  loadCheckpoint(checkpointPath: string): any {
    if (!fs.existsSync(checkpointPath)) return null;
    return JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
  }

  /**
   * 恢复所有需要重启的 Goal
   */
  async recoverAll(callback: (goalId: string, checkpoint: string | null) => Promise<void>): Promise<void> {
    const statusPath = path.join(this.projectDir, '.opencode/mafw/STATUS.md');
    if (!fs.existsSync(statusPath)) return;

    const content = fs.readFileSync(statusPath, 'utf-8');
    const blocks = content.split('---').filter(b => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const parseLine = (key: string) => {
        const line = lines.find(l => l.trim().startsWith(`${key}:`));
        return line ? line.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '') : '';
      };

      const goalId = parseLine('goalId');
      const state = parseLine('state');
      if (!goalId || state !== 'RUNNING') continue;

      const checkpoint = this.findLastCheckpoint(goalId);
      console.log(`[Recovery] Goal ${goalId} needs restart, checkpoint: ${checkpoint || 'none'}`);
      await callback(goalId, checkpoint);
    }
  }
}
