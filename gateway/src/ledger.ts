import * as fs from 'fs';
import * as path from 'path';

/**
 * Scheduler Ledger �?Scheduler 审计日志
 *
 * 独立记录 Scheduler 的事件（启动、恢复、重启、失败）�? */

export interface LedgerEntry {
  timestamp: string;
  event: string;
  goalId?: string;
  reason?: string;
  sessionId?: string;
  details?: Record<string, any>;
}

export class SchedulerLedger {
  private ledgerPath: string;

  constructor(projectDir: string = '.') {
    this.ledgerPath = path.join(projectDir, '.mafw/ledger.md');
  }

  append(entry: LedgerEntry): void {
    const line = `[${entry.timestamp}] [${entry.event}]` +
      (entry.goalId ? ` [${entry.goalId}]` : '') +
      (entry.reason ? ` reason=${entry.reason}` : '') +
      (entry.sessionId ? ` session=${entry.sessionId}` : '') +
      (entry.details ? ` ${JSON.stringify(entry.details)}` : '');

    fs.appendFileSync(this.ledgerPath, line + '\n', 'utf-8');
  }

  read(): LedgerEntry[] {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const content = fs.readFileSync(this.ledgerPath, 'utf-8');
    return content.split('\n').filter(Boolean).map(line => this.parse(line));
  }

  private parse(line: string): LedgerEntry {
    // 简单解析：[$timestamp] [$event] ...
    const match = line.match(/^\[(.+?)\] \[(.+?)\](?: \[(.+?)\])?(?: reason=(.+?))?(?: session=(.+?))?(?: (.+))?$/);
    if (!match) return { timestamp: new Date().toISOString(), event: 'UNKNOWN' };

    const [, timestamp, event, goalId, reason, sessionId, details] = match;
    return {
      timestamp,
      event,
      goalId,
      reason,
      sessionId,
      details: details ? JSON.parse(details) : undefined
    };
  }
}
