import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export type LedgerSource = 'cron' | 'event' | 'llm' | 'user';

export interface LedgerEntry {
  timestamp: string;
  event: string;
  goalId?: string;
  ruleId?: string;
  source?: LedgerSource;
  reason?: string;
  sessionId?: string;
  details?: Record<string, any>;
}

export class SchedulerLedger {
  private ledgerPath: string;

  constructor(projectDir: string = '.') {
    this.ledgerPath = path.join(projectDir, config.paths.mafwDir, 'ledger.md');
  }

  append(entry: LedgerEntry): void {
    const parts: string[] = [
      `[${entry.timestamp}]`,
      `[${entry.event}]`,
    ];
    if (entry.ruleId) parts.push(`[${entry.ruleId}]`);
    if (entry.goalId) parts.push(`[${entry.goalId}]`);
    if (entry.source) parts.push(`source=${entry.source}`);
    if (entry.reason) parts.push(`reason=${entry.reason}`);
    if (entry.sessionId) parts.push(`session=${entry.sessionId}`);
    if (entry.details) parts.push(JSON.stringify(entry.details));

    fs.appendFileSync(this.ledgerPath, parts.join(' ') + '\n', 'utf-8');
  }

  read(): LedgerEntry[] {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const content = fs.readFileSync(this.ledgerPath, 'utf-8');
    return content.split('\n').filter(Boolean).map(line => this.parse(line));
  }

  getHistory(ruleId?: string, limit?: number): LedgerEntry[] {
    let entries = this.read();
    if (ruleId) {
      entries = entries.filter(e => e.ruleId === ruleId);
    }
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (limit && entries.length > limit) {
      entries = entries.slice(-limit);
    }
    return entries.reverse();
  }

  private parse(line: string): LedgerEntry {
    const entry: LedgerEntry = { timestamp: new Date().toISOString(), event: 'UNKNOWN' };

    const tsMatch = line.match(/^\[(.+?)\]/);
    if (!tsMatch) return entry;
    entry.timestamp = tsMatch[1];

    const eventMatch = line.match(/^\[.+?\] \[(.+?)\]/);
    if (!eventMatch) return entry;
    entry.event = eventMatch[1];

    const rest = line.slice(line.indexOf(']', line.indexOf(']') + 1) + 1).trim();

    const bracketIds = [...rest.matchAll(/\[([^\]]+)\]/g)];
    if (bracketIds.length >= 1) {
      entry.ruleId = bracketIds[0][1];
    }
    if (bracketIds.length >= 2) {
      entry.goalId = bracketIds[1][1];
    }

    const sourceMatch = rest.match(/source=(\w+)/);
    if (sourceMatch && ['cron', 'llm', 'user'].includes(sourceMatch[1])) {
      entry.source = sourceMatch[1] as 'cron' | 'llm' | 'user';
    }

    const reasonMatch = rest.match(/reason=([^\s{}]+)/);
    if (reasonMatch) entry.reason = reasonMatch[1];

    const sessionMatch = rest.match(/session=([^\s{}]+)/);
    if (sessionMatch) entry.sessionId = sessionMatch[1];

    const detailsMatch = rest.match(/(\{.+})/);
    if (detailsMatch) {
      try { entry.details = JSON.parse(detailsMatch[1]); } catch { entry.details = { raw: detailsMatch[1] }; }
    }

    return entry;
  }
}
