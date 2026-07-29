import * as fs from 'fs';
import * as path from 'path';

const MAFW_DIR = '.mafw';

/**
 * Recovery �?崩溃恢复�? *
 * Scheduler 重启后：
 *   1. 读取 STATUS.md，找到所�?RUNNING 状态的 Goal
 *   2. 尝试找到最近的 Checkpoint
 *   3. 重新创建 session 并启�?Loop
 */

export class RecoveryManager {
  private projectDir: string;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
  }

  private get mafwDir(): string {
    return path.join(this.projectDir, MAFW_DIR);
  }

  /**
   * 查找最近的 Checkpoint
   */
  findLastCheckpoint(goalId: string): string | null {
    const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
    if (!fs.existsSync(checkpointsDir)) return null;

    const files = fs.readdirSync(checkpointsDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.json$/)![1], 10);
        const numB = parseInt(b.match(/(\d+)\.json$/)![1], 10);
        return numB - numA;
      });

    return files.length > 0 ? path.join(checkpointsDir, files[0]) : null;
  }

  /**
   * 保存 Checkpoint
   */
  saveCheckpoint(goalId: string, loop: number, data: any, waveNum?: number): void {
    const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
    if (!fs.existsSync(checkpointsDir)) fs.mkdirSync(checkpointsDir, { recursive: true });

    const name = waveNum !== undefined
      ? `wave-${loop}-${waveNum}.json`
      : `loop-${loop}.json`;
    const checkpointPath = path.join(checkpointsDir, name);
    const checkpoint = {
      goalId, loop, wave: waveNum,
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

  async restoreLoop(goalId: string, loop: number, targetWaveNum?: number): Promise<boolean> {
    const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
    if (!fs.existsSync(checkpointsDir)) return false;
    const pattern = targetWaveNum !== undefined
      ? `wave-${loop}-${targetWaveNum}.json`
      : `loop-${loop}.json`;
    const cpPath = path.join(checkpointsDir, pattern);
    if (!fs.existsSync(cpPath)) return false;
    const checkpoint = this.loadCheckpoint(cpPath);
    if (!checkpoint) return false;

    // Restore state file
    const statePath = path.join(this.mafwDir, 'state', `${goalId}.json`);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      state.phase = checkpoint.phase || 'PLANNING';
      state.currentWave = targetWaveNum ?? state.currentWave;
      state.updatedAt = new Date().toISOString();
      state.error = undefined;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    }

    // Truncate waves.json to remove waves after the rollback point
    if (targetWaveNum !== undefined) {
      const wavesPath = path.join(this.mafwDir, 'waves.json');
      if (fs.existsSync(wavesPath)) {
        const wavesData = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
        wavesData.waves = (wavesData.waves || []).filter((w: any) => w.waveNum <= targetWaveNum);
        fs.writeFileSync(wavesPath, JSON.stringify(wavesData, null, 2), 'utf-8');
      }
    }

    return true;
  }

  /**
   * 恢复所有需要重启的 Goal
   */
  async recoverAll(callback: (goalId: string, checkpoint: string | null) => Promise<void>): Promise<void> {
    const statusPath = path.join(this.mafwDir, 'STATUS.md');
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
