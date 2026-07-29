import * as fs from 'fs';
import * as path from 'path';

const EVENT_LOG = '.memory-events.log';

export interface LogEntry {
  op: 'write' | 'archive' | 'rename' | 'access' | 'miss';
  id?: string;
  query?: string;
  miss_cause?: string;
  entry?: any;
  score?: number;
  round?: number;
  ts?: number;
}

export class EventLog {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private logFile(): string {
    const dir = path.join(this.baseDir, 'memory');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, EVENT_LOG);
  }

  private append(entry: LogEntry): void {
    entry.ts = Date.now();
    fs.appendFileSync(this.logFile(), JSON.stringify(entry) + '\n', 'utf-8');
  }

  appendWrite(id: string, entryData: any): void {
    this.append({ op: 'write', id, entry: entryData });
  }

  appendArchive(id: string): void {
    this.append({ op: 'archive', id });
  }

  appendMiss(query: string, cause: string): void {
    this.append({ op: 'miss', query, miss_cause: cause });
  }

  appendAccess(id: string, round: number, score: number): void {
    this.append({ op: 'access', id, round, score });
  }

  readAll(): LogEntry[] {
    const filePath = this.logFile();
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip corrupt lines
      }
    }
    return entries;
  }
}
