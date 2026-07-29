import * as fs from 'fs';
import * as path from 'path';

export interface T1Observation {
  content: string;
  type?: string;
  phase?: string;
  loopNum?: number;
  timestamp?: number;
  goalId?: string;
  energy?: number;
  sessionID?: string;
  turnID?: number;
  source?: string;
  toolName?: string;
  [key: string]: unknown;
}

export class T1Store {
  private baseDir: string;
  private counts: Map<string, number> = new Map();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.loadCounts();
  }

  append(observation: T1Observation, goalId?: string): void {
    const gid = goalId || observation.goalId || 'default';
    const dir = path.join(this.baseDir, 'memory', 'tier1', gid);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = this.resolveSpiralPath(dir);
    const line = JSON.stringify(observation) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
    this.counts.set(gid, (this.counts.get(gid) || 0) + 1);
  }

  appendBatch(observations: T1Observation[], goalId?: string): void {
    for (const obs of observations) {
      this.append(obs, goalId);
    }
  }

  getCount(goalId?: string): number {
    return this.counts.get(goalId || 'default') || 0;
  }

  readAll(goalId?: string): T1Observation[] {
    return this.readFiltered({}, goalId);
  }

  readBySession(sessionID: string, goalId?: string): T1Observation[] {
    return this.readFiltered({ sessionID }, goalId);
  }

  hasSession(sessionID: string, goalId?: string): boolean {
    return this.readBySession(sessionID, goalId).length > 0;
  }

  clearSession(sessionID: string, goalId?: string): void {
    const gid = goalId || 'default';
    const dir = path.join(this.baseDir, 'memory', 'tier1', gid);
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir)
      .filter(f => f.startsWith('spiral-') && f.endsWith('.jsonl'))
      .sort();
    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const remaining = lines.filter(line => {
        try {
          const obs = JSON.parse(line);
          return obs.sessionID !== sessionID;
        } catch {
          return true;
        }
      });
      if (remaining.length === 0) {
        fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, remaining.join('\n') + '\n', 'utf-8');
      }
    }
    this.loadCounts();
  }

  clear(goalId?: string): void {
    const gid = goalId || 'default';
    const dir = path.join(this.baseDir, 'memory', 'tier1', gid);
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir)
        .filter(f => f.startsWith('spiral-') && f.endsWith('.jsonl'));
      for (const entry of entries) {
        fs.unlinkSync(path.join(dir, entry));
      }
    }
    this.counts.set(gid, 0);
  }

  private readFiltered(filter: Partial<T1Observation>, goalId?: string): T1Observation[] {
    const gid = goalId || 'default';
    const dir = path.join(this.baseDir, 'memory', 'tier1', gid);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir)
      .filter(f => f.startsWith('spiral-') && f.endsWith('.jsonl'))
      .sort();
    const result: T1Observation[] = [];
    for (const entry of entries) {
      const content = fs.readFileSync(path.join(dir, entry), 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          const obs = JSON.parse(line);
          const matches = Object.entries(filter).every(([k, v]) => obs[k] === v);
          if (matches) result.push(obs);
        } catch {
          // skip malformed lines
        }
      }
    }
    return result;
  }

  private resolveSpiralPath(dir: string): string {
    const entries = fs.readdirSync(dir)
      .filter(f => f.startsWith('spiral-') && f.endsWith('.jsonl'))
      .sort();
    if (entries.length > 0) {
      const lastPath = path.join(dir, entries[entries.length - 1]);
      const lineCount = this.countLines(lastPath);
      if (lineCount < 1000) {
        return lastPath;
      }
    }
    const nextNum = entries.length + 1;
    return path.join(dir, `spiral-${nextNum}.jsonl`);
  }

  private countLines(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  private loadCounts(): void {
    const tier1Dir = path.join(this.baseDir, 'memory', 'tier1');
    if (!fs.existsSync(tier1Dir)) return;
    const goalDirs = fs.readdirSync(tier1Dir);
    for (const goalId of goalDirs) {
      const goalPath = path.join(tier1Dir, goalId);
      if (!fs.statSync(goalPath).isDirectory()) continue;
      const entries = fs.readdirSync(goalPath)
        .filter(f => f.startsWith('spiral-') && f.endsWith('.jsonl'));
      let total = 0;
      for (const entry of entries) {
        total += this.countLines(path.join(goalPath, entry));
      }
      this.counts.set(goalId, total);
    }
  }
}
