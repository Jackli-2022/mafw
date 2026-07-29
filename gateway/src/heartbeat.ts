import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export interface HeartbeatStatus {
  goalId: string;
  state: string;
  loop: number;
  wave: number;
  task: string;
  progress: string;
  lastHeartbeat: string;
  sessionId: string | null;
  directory: string;
}

export class HeartbeatMonitor {
  private statusPath: string;
  private timeoutMs: number;

  constructor(projectDir: string = '.', timeoutMs: number = config.timeouts.heartbeatTimeout) {
    this.statusPath = path.join(projectDir, config.paths.mafwDir, 'STATUS.md');
    this.timeoutMs = timeoutMs;
  }

  /**
   * 检查所有活�?Goal 的心�?   */
  check(): { healthy: HeartbeatStatus[]; stuck: HeartbeatStatus[] } {
    const all = this.loadAll();
    const running = all.filter(g => g.state === 'RUNNING');
    const now = Date.now();

    const healthy: HeartbeatStatus[] = [];
    const stuck: HeartbeatStatus[] = [];

    for (const g of running) {
      const lastBeat = new Date(g.lastHeartbeat).getTime();
      if (now - lastBeat > this.timeoutMs) {
        stuck.push(g);
      } else {
        healthy.push(g);
      }
    }

    return { healthy, stuck };
  }

  /**
   * 加载所�?Goal 状�?   */
  loadAll(): HeartbeatStatus[] {
    if (!fs.existsSync(this.statusPath)) return [];
    const content = fs.readFileSync(this.statusPath, 'utf-8');
    return this.parse(content);
  }

  /**
   * 解析�?Goal STATUS.md 格式
   */
  private parse(content: string): HeartbeatStatus[] {
    const blocks = content.split('---').filter(b => b.trim());
    const goals: HeartbeatStatus[] = [];

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const parseLine = (key: string) => {
        const line = lines.find(l => l.trim().startsWith(`${key}:`));
        if (!line) return '';
        const value = line.split(':').slice(1).join(':').trim();
        return value.replace(/^"|"$/g, ''); // 去除引号
      };

      const goalId = parseLine('goalId');
      if (!goalId) continue;

      goals.push({
        goalId,
        state: parseLine('state') || 'UNKNOWN',
        loop: parseInt(parseLine('loop'), 10) || 0,
        wave: parseInt(parseLine('wave'), 10) || 0,
        task: parseLine('task') || '',
        progress: parseLine('progress') || '0%',
        lastHeartbeat: parseLine('lastHeartbeat') || new Date().toISOString(),
        sessionId: parseLine('sessionId') || null,
        directory: parseLine('directory') || '.'
      });
    }

    return goals;
  }
}
