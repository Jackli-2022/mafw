/**
 * Loop Monitor — Loop 心跳监控
 */
import * as fs from 'fs';
import { config } from './config';

export class LoopMonitor {
  private statusPath: string;

  constructor(statusPath: string) {
    this.statusPath = statusPath;
  }

  isStuck(timeoutMs: number = config.timeouts.stuckLoopTimeout): boolean {
    if (!fs.existsSync(this.statusPath)) return false;
    const content = fs.readFileSync(this.statusPath, 'utf-8');
    const match = content.match(/updated_at:\s*(.+)/);
    if (!match) return false;
    const lastUpdate = new Date(match[1].trim()).getTime();
    return (Date.now() - lastUpdate) > timeoutMs;
  }

  getState(): { goalId: string; state: string; loop: number; updatedAt: string } | null {
    if (!fs.existsSync(this.statusPath)) return null;
    const content = fs.readFileSync(this.statusPath, 'utf-8');
    const lines = content.split('\n');
    const parse = (key: string) => {
      const line = lines.find(l => l.startsWith(key + ':'));
      return line ? line.split(':').slice(1).join(':').trim() : '';
    };
    return {
      goalId: parse('goal_id'),
      state: parse('state'),
      loop: parseInt(parse('loop'), 10) || 0,
      updatedAt: parse('updated_at')
    };
  }
}
