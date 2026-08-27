import * as fs from 'fs';
import * as path from 'path';

/**
 * State Machine Utilities — v3.5
 *
 * 核心职责：
 *   - updateState: Skill Entry 末尾显式更新 state.json
 *   - loadState: 读取当前状态
 *   - loadRequest: 读取请求配置
 *   - loadGoal: 读取 Goal Charter
 *   - loadWaves: 读取 Plan 产出
 *   - loadReceipts: 读取 Execute 产出
 *   - loadReview: 读取 Review 产出
 *
 * 设计原则：
 *   - 所有状态写入必须是原子操作（先写文件，再返回）
 *   - 所有读取必须验证文件存在性
 *   - 所有路径基于 projectDir 解析，避免硬编码
 */

export interface StateFile {
  version: string;
  goalId: string;
  loop: number;
  phase: string | null;
  lastPhase: string | null;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, SessionInfo>;
  nextAction: string;
  artifacts: Record<string, string>;
  metrics?: Record<string, number>;
  error?: string;
  updatedAt: string;
  policySnapshot?: { version: string; proposalId: string | null };
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  destroyedAt?: string;
  active: boolean;
}

export interface GoalRequest {
  version: string;
  goalId: string;
  title: string;
  state: string;
  createdAt: string;
  confirmedAt: string;
  source: string;
  projectDir: string;
  mafwDir: string;
  goalCharter: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  priority: string;
  maxLoops: number;
  parallel: boolean;
  degradeOnLoop: number;
  remoteCli?: {
    host: string;
    projectDir: string;
    syncOnExecute: boolean;
    testCommand: string;
  };
}

/**
 * 更新状态文件（主路径，Skill Entry 末尾调用）
 */
export async function updateState(
  goalId: string,
  patch: Partial<StateFile>,
  projectDir: string = '.'
): Promise<StateFile> {
  const statePath = path.join(projectDir, '.mafw/state', `${goalId}.json`);

  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}`);
  }

  const current: StateFile = safeJsonParse<StateFile>(statePath);
  const updated: StateFile = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  // 原子写入：先写临时文件，再重命名
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);

  return updated;
}

function safeJsonParse<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err: any) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
}

/**
 * 加载状态文件
 */
export async function loadState(goalId: string, projectDir: string = '.'): Promise<StateFile> {
  const statePath = path.join(projectDir, '.mafw/state', `${goalId}.json`);
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}`);
  }
  return safeJsonParse<StateFile>(statePath);
}

/**
 * 加载请求配置
 */
export async function loadRequest(goalId: string, projectDir: string = '.'): Promise<GoalRequest> {
  const reqPath = path.join(projectDir, '.mafw/requests', `${goalId}.json`);
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Request file not found: ${reqPath}`);
  }
  return safeJsonParse<GoalRequest>(reqPath);
}

/**
 * 加载 Goal Charter
 */
export async function loadGoal(goalId: string, projectDir: string = '.'): Promise<string> {
  const goalPath = path.join(projectDir, '.mafw/goals', `${goalId}.md`);
  if (!fs.existsSync(goalPath)) {
    throw new Error(`Goal Charter not found: ${goalPath}`);
  }
  return fs.readFileSync(goalPath, 'utf-8');
}

/**
 * 加载 Waves 配置
 */
export async function loadWaves(goalId: string, projectDir: string = '.'): Promise<any[]> {
  const wavesPath = path.join(projectDir, '.mafw/waves.json');
  if (!fs.existsSync(wavesPath)) {
    return [];
  }
  const data = safeJsonParse<any>(wavesPath);
  return data.waves || [];
}

/**
 * 加载 Receipts
 */
export async function loadReceipts(goalId: string, projectDir: string = '.'): Promise<any[]> {
  const receiptsDir = path.join(projectDir, '.mafw/receipts', goalId);
  if (!fs.existsSync(receiptsDir)) {
    return [];
  }
  const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
  return files.map(f => safeJsonParse<any>(path.join(receiptsDir, f)));
}

/**
 * 加载 Review 文件
 */
export async function loadReview(goalId: string, loop: number, projectDir: string = '.'): Promise<any> {
  const reviewPath = path.join(projectDir, '.mafw/reviews', `${goalId}-loop${loop}.md`);
  if (!fs.existsSync(reviewPath)) {
    return null;
  }
  return fs.readFileSync(reviewPath, 'utf-8');
}

/**
 * 提取 Goal ID 从消息
 */
export function extractGoalId(message: string): string {
  const parts = message.trim().split(/\s+/).filter(Boolean);
  // 支持格式: /skill mafw-plan 001-auth
  return parts[parts.length - 1] || '';
}

/**
 * 检查状态文件是否存在
 */
export function stateExists(goalId: string, projectDir: string = '.'): boolean {
  const statePath = path.join(projectDir, '.mafw/state', `${goalId}.json`);
  return fs.existsSync(statePath);
}

/**
 * 初始化新 Goal 的状态文件
 */
export function initState(goalId: string, projectDir: string = '.'): void {
  const stateDir = path.join(projectDir, '.mafw/state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const state: StateFile = {
    version: '2',
    goalId,
    loop: 1,
    phase: 'PLANNING',
    lastPhase: null,
    currentWave: 0,
    totalWaves: null,
    sessions: {},
    nextAction: 'CREATE_PLAN_SESSION',
    artifacts: {},
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(stateDir, `${goalId}.json`),
    JSON.stringify(state, null, 2),
    'utf-8'
  );
}
