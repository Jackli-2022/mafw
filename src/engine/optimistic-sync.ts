import * as fs from 'fs';
import * as path from 'path';

export interface CausalEvent {
  seq: number;
  agent: string;
  operation: string;
  timestamp: string;
}

export interface CausalContext {
  version: number;
  events: CausalEvent[];
}

export class OptimisticStateSync {
  private projectDir: string;
  private contexts: Map<string, CausalContext>;
  private maxEvents: number;

  constructor(projectDir: string, maxEvents: number = 20) {
    this.projectDir = projectDir;
    this.contexts = new Map();
    this.maxEvents = maxEvents;
  }

  private statePath(goalId: string): string {
    return path.join(this.projectDir, '.mafw', 'state', `${goalId}.json`);
  }

  async updateState(
    goalId: string,
    patch: any,
    expectedVersion: number,
    agent?: string
  ): Promise<boolean> {
    const filePath = this.statePath(goalId);
    let current: any;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      current = JSON.parse(raw);
    } catch {
      return false;
    }
    if (current.version !== expectedVersion) {
      return false;
    }
    const newVersion = expectedVersion + 1;
    const newState = { ...current, ...patch, version: newVersion };
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(newState, null, 2));
    fs.renameSync(tmpPath, filePath);

    let ctx = this.contexts.get(goalId) || { version: 0, events: [] };
    ctx.version = newVersion;
    if (agent) {
      ctx.events.push({
        seq: ctx.events.length + 1,
        agent,
        operation: patch.phase ? `phase.${patch.phase}` : 'state.update',
        timestamp: new Date().toISOString()
      });
      if (ctx.events.length > this.maxEvents) {
        ctx.events = ctx.events.slice(-this.maxEvents);
      }
    }
    this.contexts.set(goalId, ctx);

    return true;
  }

  getCausalContext(goalId: string): CausalContext {
    return this.contexts.get(goalId) || { version: 0, events: [] };
  }

  async readCurrentVersion(goalId: string): Promise<number> {
    const filePath = this.statePath(goalId);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const state = JSON.parse(raw);
      return state.version ?? -1;
    } catch {
      return -1;
    }
  }
}
