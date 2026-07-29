import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

/**
 * Request Manager �?读写 requests/ 目录的请求文�? *
 * Schema: .mafw/requests/{goalId}.json
 */

export interface GoalRequest {
  version: string;
  goalId: string;
  title: string;
  state: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED' | 'ABORTED';
  createdAt: string;
  confirmedAt: string;
  source: string;
  projectDir: string;
  goalCharter: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  priority: string;
  maxLoops: number;
  degradeOnLoop: number;
  resumeFrom?: string; // checkpoint path
  updatedAt?: string;
  sessionId?: string;
}

export class RequestManager {
  private requestsDir: string;

  constructor(projectDir: string = '.') {
    this.requestsDir = path.join(projectDir, config.paths.mafwDir, 'requests');
    if (!fs.existsSync(this.requestsDir)) {
      fs.mkdirSync(this.requestsDir, { recursive: true });
    }
  }

  /**
   * 加载所有请求文�?   */
  loadAll(): GoalRequest[] {
    const files = fs.readdirSync(this.requestsDir).filter(f => f.endsWith('.json'));
    return files.map(f => this.load(f.replace('.json', ''))).filter(Boolean) as GoalRequest[];
  }

  /**
   * 加载单个请求
   */
  load(goalId: string): GoalRequest | null {
    const p = path.join(this.requestsDir, `${goalId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoalRequest;
  }

  /**
   * 更新请求状�?   */
  updateState(goalId: string, state: GoalRequest['state'], sessionId?: string): void {
    const req = this.load(goalId);
    if (!req) return;
    req.state = state;
    req.updatedAt = new Date().toISOString();
    if (sessionId) req.sessionId = sessionId;
    this.save(req);
  }

  /**
   * 保存请求
   */
  save(req: GoalRequest): void {
    const p = path.join(this.requestsDir, `${req.goalId}.json`);
    fs.writeFileSync(p, JSON.stringify(req, null, 2), 'utf-8');
  }

  /**
   * 查找 PENDING 状态的请求
   */
  findPending(): GoalRequest[] {
    return this.loadAll().filter(r => r.state === 'PENDING');
  }

  /**
   * 查找 RUNNING 状态的请求
   */
  findRunning(): GoalRequest[] {
    return this.loadAll().filter(r => r.state === 'RUNNING');
  }

  /**
   * 移动已完成的请求�?processed/
   */
  archive(goalId: string): void {
    const src = path.join(this.requestsDir, `${goalId}.json`);
    const processedDir = path.join(this.requestsDir, '../processed');
    if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });
    const dest = path.join(processedDir, `${goalId}.json`);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
    }
  }
}
