import * as fs from 'fs';
import * as path from 'path';

/**
 * Status Manager — v2.1 更新
 *
 * 支持多 Goal STATUS.md 格式（文档 §2.2）。
 * 每个 Goal 一个 YAML 块，用 --- 分隔。
 */

export interface GoalStatus {
  goalId: string;
  state: string;
  loop: number;
  wave: number;
  task: string;
  progress: string;
  lastHeartbeat: string;
  sessionId: string | null;
  directory: string;
  phase?: string | null;
}

export class StatusManager {
  private statusPath: string;

  constructor(projectDir: string = '.') {
    this.statusPath = path.join(projectDir, '.opencode/mafw/STATUS.md');
  }

  /**
   * 读取所有 Goal 状态
   */
  readAll(): GoalStatus[] {
    if (!fs.existsSync(this.statusPath)) return [];
    const content = fs.readFileSync(this.statusPath, 'utf-8');
    return this.parse(content);
  }

  /**
   * 读取单个 Goal 状态
   */
  read(goalId: string): GoalStatus | null {
    return this.readAll().find(g => g.goalId === goalId) || null;
  }

  /**
   * 更新或创建 Goal 状态
   */
  update(goalId: string, updates: Partial<GoalStatus>): void {
    const all = this.readAll();
    const idx = all.findIndex(g => g.goalId === goalId);

    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates, lastHeartbeat: new Date().toISOString() };
    } else {
      all.push({
        goalId,
        state: 'UNKNOWN',
        loop: 0,
        wave: 0,
        task: '',
        progress: '0%',
        lastHeartbeat: new Date().toISOString(),
        sessionId: null,
        directory: '.',
        ...updates
      });
    }

    this.write(all);
  }

  /**
   * 解析多 Goal STATUS.md
   */
  private parse(content: string): GoalStatus[] {
    const blocks = content.split('---').filter(b => b.trim());
    const goals: GoalStatus[] = [];

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const parseLine = (key: string) => {
        const line = lines.find(l => l.trim().startsWith(`${key}:`));
        if (!line) return '';
        const value = line.split(':').slice(1).join(':').trim();
        return value.replace(/^"|"$/g, '');
      };

      const goalId = parseLine('goalId');
      if (!goalId) continue;

      const sessionId = parseLine('sessionId');
      goals.push({
        goalId,
        state: parseLine('state') || 'UNKNOWN',
        loop: parseInt(parseLine('loop'), 10) || 0,
        wave: parseInt(parseLine('wave'), 10) || 0,
        task: parseLine('task') || '',
        progress: parseLine('progress') || '0%',
        lastHeartbeat: parseLine('lastHeartbeat') || new Date().toISOString(),
        sessionId: sessionId === 'null' || !sessionId ? null : sessionId,
        directory: parseLine('directory') || '.'
      });
    }

    return goals;
  }

  /**
   * 写入多 Goal STATUS.md
   */
  private write(goals: GoalStatus[]): void {
    fs.mkdirSync(path.dirname(this.statusPath), { recursive: true });
    const lines = [
      '# MAFW Status',
      '',
      `lastUpdated: "${new Date().toISOString()}"`,
      `activeGoals: ${goals.filter(g => g.state === 'RUNNING').length}`,
      `pendingGoals: ${goals.filter(g => g.state === 'PENDING').length}`,
      ''
    ];

    for (const g of goals) {
      lines.push('---');
      lines.push(`goalId: "${g.goalId}"`);
      lines.push(`state: "${g.state}"`);
      lines.push(`loop: ${g.loop}`);
      lines.push(`wave: ${g.wave}`);
      lines.push(`task: "${g.task}"`);
      lines.push(`progress: "${g.progress}"`);
      lines.push(`lastHeartbeat: "${g.lastHeartbeat}"`);
      lines.push(`sessionId: ${g.sessionId ? `"${g.sessionId}"` : 'null'}`);
      lines.push(`directory: "${g.directory}"`);
      lines.push('');
    }

    fs.writeFileSync(this.statusPath, lines.join('\n'), 'utf-8');
  }

  /**
   * 检查是否卡死（5 分钟无更新）
   */
  isStuck(goalId: string): boolean {
    const goal = this.read(goalId);
    if (!goal) return false;
    const lastUpdate = new Date(goal.lastHeartbeat).getTime();
    return (Date.now() - lastUpdate) > 5 * 60 * 1000;
  }
}
