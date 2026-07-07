import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn, execSync, ChildProcess } from 'child_process';
import { DashboardServer } from './dashboard/server';
import { buildLoopGraph, planNode, executeNode, reviewNode, syncNode, syncToDashboard, SessionClient } from '../../src/langgraph';
import { MemorySaver } from '@langchain/langgraph';

/**
 * MAFW Scheduler — v5.0 SDK 编排器
 *
 * 核心设计原则：
 *   - 使用 @opencode-ai/sdk 管理 Serve 进程和 Session 生命周期
 *   - 无状态业务判断: 不读取 waves.json、不解析 review、不计算 loop
 *   - 文件驱动: 只读取已注册项目的 state/{goalId}.json 的 nextAction 字段
 *   - 注册表持久化: 插件注册信息写入磁盘，崩溃后可恢复
 *   - 写队列防并发: 多个 /register 同时到达时，写磁盘串行化
 *   - 可恢复: 崩溃重启后从 state/ 文件 + 注册表恢复所有活跃 Goal
 */


interface StateFile {
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
}

interface SessionInfo {
  id: string;
  createdAt: string;
  destroyedAt?: string;
  active: boolean;
}

interface RegisteredProject {
  projectDir: string;
  mafwDir: string;
  registeredAt: string;
}

interface Session {
  id: string;
  createdAt: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function resolveOpencode(): string {
  // 按优先级查找 opencode.exe
  const npmPrefix = process.env.MAFW_OPENCODE_PATH
    ? path.dirname(process.env.MAFW_OPENCODE_PATH)
    : execSync('npm config get prefix', { encoding: 'utf-8' }).trim();

  const candidates = [
    path.join(npmPrefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(npmPrefix, 'node_modules', '@opencode-ai', 'cli', 'bin', 'lildax'),
    path.join(npmPrefix, 'opencode.cmd'),
    path.join(npmPrefix, 'opencode'),
    process.env.MAFW_OPENCODE_PATH || '',
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('opencode CLI not found. Install: npm install -g @opencode-ai/cli');
}

class MafwScheduler {
  private serveProcess?: ChildProcess;
  private serveUrl = 'http://127.0.0.1:4096';
  private apiPort = 3000;
  private pollInterval = 5000;
  private projectDir: string;

  activeGoals = new Map<string, StateFile>();
  registeredProjects = new Map<string, RegisteredProject>();
  private registryPath: string;
  private registryWriteQueue: Promise<void> = Promise.resolve();
  private configPath: string;
  private configWriteQueue: Promise<void> = Promise.resolve();
  private running = true;
  private dashboard?: DashboardServer;
  private opencodeClient: any = null;
  private sseClients: Set<http.ServerResponse> = new Set();

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.configPath = path.join(os.homedir(), '.config', 'mafw', 'config.json');
    this.registryPath = path.join(projectDir, 'scheduler', 'registered-projects.json');
  }

  get serveRunning(): boolean {
    return !!this.serveProcess && !this.serveProcess.killed;
  }

  async start() {
    console.log('[Scheduler] MAFW Scheduler v5.0 starting...');

    // 1. 启动 Serve（spawn opencode.exe 全路径）
    await this.startServe();

    // 2. 初始化 SDK 客户端
    if (this.serveProcess) {
      await this.initClient();
      this.subscribeToEvents();
    }

    // 3. 启动 HTTP API
    await this.startApiServer();

    // 4. 启动 Dashboard
    this.dashboard = new DashboardServer(3001, this.projectDir, this);
    this.dashboard.start();

    // 5. 恢复配置和注册表
    await this.recoverConfig();
    await this.recoverRegistry();

    // 6. 恢复活跃 Goal
    await this.recoverState();

    // 7. 开始轮询（降级兜底，30s）
    console.log('[Scheduler] Starting backup polling loop (30s)...');
    this.startBackupPolling();
  }

  private async subscribeToEvents() {
    try {
      const stream = await this.opencodeClient.event.subscribe({});
      if (stream && typeof stream.on === 'function') {
        stream.on('data', (event: any) => {
          this.broadcast({ type: 'opencode_event', data: event });
        });
        console.log('[Scheduler] Subscribed to OpenCode events');
      }
    } catch (err: any) {
      console.warn(`[Scheduler] SDK event subscribe failed (non-fatal): ${err.message}`);
    }
  }

  private broadcast(event: { type: string; [key: string]: any }): void {
    const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(data); } catch { this.sseClients.delete(client); }
    }
  }

  stop() {
    this.running = false;
    if (this.serveProcess) {
      this.serveProcess.kill('SIGTERM');
      this.serveProcess = undefined;
    }
    if (this.dashboard) {
      this.dashboard.stop();
    }
    console.log('[Scheduler] Stopping...');
  }

  // ── 1. Serve 管理 ──

  private async startServe() {
    const opencodeExe = resolveOpencode();
    console.log(`[Scheduler] Starting OpenCode Serve: ${opencodeExe}`);
    this.serveProcess = spawn(opencodeExe, [
      'serve', '--port', '4096', '--hostname', '127.0.0.1'
    ], {
      cwd: this.projectDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PATH: process.env.PATH },
      windowsHide: true
    });

    if (this.serveProcess.stdout) {
      this.serveProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log(`[Serve] ${line}`);
      });
      this.serveProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.error(`[Serve] ${line}`);
      });
    }

    this.serveProcess.on('exit', (code: number | null) => {
      console.error(`[Scheduler] Serve exited with code ${code}, restarting in 5s...`);
      this.serveProcess = undefined;
      if (this.running) {
        setTimeout(() => this.startServe(), 5000);
      }
    });

    await this.waitForServeReady();
  }

  private async isServeHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serveUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForServeReady(): Promise<void> {
    for (let retries = 0; retries < 60; retries++) {
      await this.sleep(1000);
      if (await this.isServeHealthy()) {
        console.log('[Scheduler] Serve is ready');
        return;
      }
    }
    throw new Error('Failed to start OpenCode Serve after 60 seconds');
  }

  private async initClient() {
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    this.opencodeClient = createOpencodeClient({ baseUrl: this.serveUrl });
    console.log('[Scheduler] SDK client initialized');
  }

  // ── 2. HTTP API ──

  private async startApiServer() {
    return new Promise<void>((resolve) => {
      const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        // 插件注册：必须传递 projectDir + mafwDir
        if (req.url === '/register' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const { projectDir, mafwDir } = data;

              if (!projectDir || !mafwDir) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing projectDir or mafwDir' }));
                return;
              }

              this.registeredProjects.set(projectDir, {
                projectDir,
                mafwDir,
                registeredAt: new Date().toISOString()
              });

              // 持久化到磁盘（写队列防并发覆盖）
              await this.persistRegistry();
              await this.persistConfig();

              console.log(`[Scheduler] Project registered: ${projectDir}`);
              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok', registered: projectDir }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // 控制指令
        if (req.url === '/control' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const control = JSON.parse(body);
              console.log(`[Scheduler] HTTP control: ${control.action} ${control.goalId || ''}`);

              // 直接处理控制指令（同 processControlFile 逻辑）
              switch (control.action) {
                case 'PAUSE':
                  if (control.goalId) await this.patchState(control.goalId, { nextAction: 'PAUSED' });
                  break;
                case 'ABORT':
                  if (control.goalId) {
                    await this.destroyAllSessions(control.goalId);
                    await this.patchState(control.goalId, { nextAction: 'FAILED' });
                  }
                  break;
                case 'FORCE_PHASE':
                  if (control.goalId && control.targetPhase) {
                    await this.destroyAllSessions(control.goalId);
                    await this.patchState(control.goalId, {
                      nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
                    });
                  }
                  break;
                case 'RESET_PARAMETRIC':
                  console.log('[Scheduler] Resetting parametric cache...');
                  break;
              }

              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // POST /api/work/{goalId}/validate — MCP calls when agent completes goal creation
        const validateMatch = req.url?.match(/^\/api\/work\/([^/]+)\/validate$/);
        if (validateMatch && req.method === 'POST') {
          try {
            const goalId = validateMatch[1];
            const body = await readBody(req);
            const data = body ? JSON.parse(body) : {};
            const result = await this.handleValidate(goalId, data);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            const status = err.message === 'Goal already exists' ? 409 : 400;
            res.writeHead(status);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/work/{goalId}/complete — MCP calls when agent completes a phase
        const completeMatch = req.url?.match(/^\/api\/work\/([^/]+)\/complete$/);
        if (completeMatch && req.method === 'POST') {
          try {
            const goalId = completeMatch[1];
            const body = await readBody(req);
            const data = body ? JSON.parse(body) : {};
            const result = await this.handleComplete(goalId, data);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 健康检查
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            serveRunning: !!this.serveProcess && !this.serveProcess.killed,
            registeredProjects: Array.from(this.registeredProjects.keys()),
            activeGoals: Array.from(this.activeGoals.keys())
          }));
          return;
        }

        // 状态变更回调 (来自 Plugin updateState)
        // 状态变更回调 (来自 Plugin updateState)
        if (req.url && req.url.startsWith('/api/events') && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const event = JSON.parse(body);
              console.log(`[Events] Received: ${event.type} for ${event.goalId || ''}`);
              this.broadcast(event);
              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid event' }));
            }
          });
          return;
        }

        // SSE 事件流 (给 Dashboard)
        if (req.url && req.url.startsWith('/api/events') && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
          this.sseClients.add(res);
          req.on('close', () => { this.sseClients.delete(res); });
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      server.listen(this.apiPort, () => {
        console.log(`[Scheduler] HTTP API on port ${this.apiPort}`);
        console.log(`[Scheduler]  - POST /register  { projectDir, mafwDir }`);
        console.log(`[Scheduler]  - POST /control  { action, goalId, ... }`);
        console.log(`[Scheduler]  - GET  /health`);
        resolve();
      });
    });
  }

  // ── 3. 注册表持久化（写队列防并发） ──

  private async persistRegistry() {
    this.registryWriteQueue = this.registryWriteQueue.then(async () => {
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.registryPath,
        JSON.stringify(Array.from(this.registeredProjects.entries()), null, 2)
      );
    });
    await this.registryWriteQueue;
  }

  private async recoverRegistry() {
    if (fs.existsSync(this.registryPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
        this.registeredProjects = new Map(data);
        console.log(`[Scheduler] Recovered ${data.length} registered projects`);
      } catch (err: any) {
        console.error(`[Scheduler] Failed to recover registry: ${err.message}`);
      }
    }
  }

  private async persistConfig() {
    this.configWriteQueue = this.configWriteQueue.then(async () => {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let config: any = {};
      if (fs.existsSync(this.configPath)) {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
      config.projects = Object.fromEntries(this.registeredProjects);
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    });
    await this.configWriteQueue;
  }

  private async recoverConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.registeredProjects = new Map(Object.entries(config.projects || {}));
      } catch (err: any) {
        console.error(`[Scheduler] Failed to recover config: ${err.message}`);
      }
    }
  }

  // ── 4. 轮询（降级兜底：仅处理 SSE 丢失的 goal） ──

  private startBackupPolling() {
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.discoverNewGoals();
        // 仅处理不在活跃缓存中的 goal
        for (const [goalId, state] of this.activeGoals) {
          if (['COMPLETED', 'FAILED'].includes(state.nextAction)) {
            this.activeGoals.delete(goalId);
          }
        }
      } catch (err: any) {
        console.error('[Scheduler] Backup poll error:', err.message);
      }
      setTimeout(poll, 30000);
    };
    setTimeout(poll, 30000);
  }

  // 轮询已注册项目的 state/ 目录
  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      // 清理 stale entry（项目目录已删除）
      if (!fs.existsSync(info.mafwDir)) {
        console.warn(`[Scheduler] Project ${projectDir} no longer exists, removing from registry`);
        this.registeredProjects.delete(projectDir);
        await this.persistRegistry();
        continue;
      }

      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) continue;

      const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const file of stateFiles) {
        try {
          const statePath = path.join(stateDir, file);
          const state: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

          if (!this.activeGoals.has(state.goalId) &&
              state.nextAction !== 'COMPLETED' &&
              state.nextAction !== 'FAILED') {
            this.activeGoals.set(state.goalId, state);
            console.log(`[Scheduler] Discovered new goal ${state.goalId} at ${state.phase}`);
          } else if (this.activeGoals.has(state.goalId)) {
            // 更新缓存中的状态
            this.activeGoals.set(state.goalId, state);
          }
        } catch (err: any) {
          console.warn(`[Scheduler] Failed to read state ${file}: ${err.message}`);
        }
      }
    }
  }

  // ── 6. Archive ──

  private async loadArchiveModule(): Promise<{ archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> }> {
    const pluginRoot = path.resolve(__dirname, '..', '..');
    const builtPath = path.join(pluginRoot, 'dist', 'tools', 'archive-worktree');
    const srcPath = path.join(pluginRoot, 'src', 'tools', 'archive-worktree');
    const modulePath = fs.existsSync(`${builtPath}.js`) ? builtPath : srcPath;
    return await import(modulePath) as { archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> };
  }

  private async archiveGoal(goalId: string) {
    console.log(`[Scheduler] Archiving goal ${goalId}`);
    await this.destroyAllSessions(goalId);

    let projectDir: string | null = null;
    for (const [pDir, info] of this.registeredProjects) {
      if (fs.existsSync(path.join(info.mafwDir, 'state', `${goalId}.json`))) {
        projectDir = pDir;
        break;
      }
    }

    if (projectDir) {
      try {
        const { archiveWorktree } = await this.loadArchiveModule();
        const state = this.activeGoals.get(goalId);
        await archiveWorktree({ goalId, projectDir, loopCount: state?.loop || 1 });
      } catch (err: any) {
        console.error(`[Scheduler] Archive failed for ${goalId}: ${err.message}`);
        await this.destroyAllSessions(goalId);
        await this.patchState(goalId, {
          nextAction: 'FAILED',
          phase: 'ARCHIVED',
          error: 'archive_failed'
        });
        return;
      }
    }

    await this.patchState(goalId, {
      nextAction: 'COMPLETED',
      phase: 'ARCHIVED'
    });

    console.log(`[Scheduler] Goal ${goalId} archived`);
  }

  // ── 9. 恢复 ──

  private async recoverState() {
    for (const [projectDir, info] of this.registeredProjects) {
      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) continue;

      const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const file of stateFiles) {
        try {
          const statePath = path.join(stateDir, file);
          const state: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          if (state.nextAction !== 'COMPLETED' && state.nextAction !== 'FAILED') {
            this.activeGoals.set(state.goalId, state);
            console.log(`[Scheduler] Recovered goal ${state.goalId} at ${state.phase}`);
          }
        } catch (err: any) {
          console.warn(`[Scheduler] Failed to recover ${file}: ${err.message}`);
        }
      }
    }
  }

  // ── 10. 控制文件处理 ──

  private async processControlFile() {
    for (const [, info] of this.registeredProjects) {
      const controlPath = path.join(info.mafwDir, 'control');
      if (!fs.existsSync(controlPath)) continue;

      try {
        const control = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
        console.log(`[Scheduler] Control action: ${control.action} ${control.goalId || ''}`);

        switch (control.action) {
          case 'PAUSE':
            if (control.goalId) {
              await this.patchState(control.goalId, { nextAction: 'PAUSED' });
            }
            break;
          case 'ABORT':
            if (control.goalId) {
              await this.destroyAllSessions(control.goalId);
              await this.patchState(control.goalId, { nextAction: 'FAILED' });
            }
            break;
          case 'FORCE_PHASE':
            if (control.goalId && control.targetPhase) {
              await this.destroyAllSessions(control.goalId);
              await this.patchState(control.goalId, {
                nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
              });
            }
            break;
          case 'RESET_PARAMETRIC':
            console.log('[Scheduler] Resetting parametric cache...');
            break;
        }

        fs.unlinkSync(controlPath);
      } catch (err: any) {
        console.error(`[Scheduler] Control file error: ${err.message}`);
      }
    }
  }

  // ── 工具函数（使用 SDK 客户端） ──

  private async createSession(projectDir: string): Promise<Session> {
    const result = await this.opencodeClient.session.create({
      directory: projectDir,
      metadata: { mafw: true }
    });
    return { id: result.id, createdAt: result.createdAt || new Date().toISOString() };
  }

  private async sendPrompt(sessionId: string, message: string) {
    await this.opencodeClient.session.promptAsync({
      sessionID: sessionId,
      message
    });
  }

  private async destroySession(sessionId: string) {
    try {
      await this.opencodeClient.session.delete({ sessionID: sessionId });
    } catch (err: any) {
      console.warn(`[Scheduler] Failed to destroy session ${sessionId}: ${err.message}`);
    }
  }

  private async destroyAllSessions(goalId: string) {
    const state = this.activeGoals.get(goalId);
    if (!state) return;
    for (const [, session] of Object.entries(state.sessions)) {
      if (session.active) {
        await this.destroySession(session.id);
      }
    }
  }

  private async patchState(goalId: string, patch: Partial<StateFile>) {
    // 找到 state 文件路径
    let statePath: string | null = null;
    for (const [, info] of this.registeredProjects) {
      const p = path.join(info.mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(p)) {
        statePath = p;
        break;
      }
    }

    if (!statePath) {
      console.error(`[Scheduler] State file not found for ${goalId}`);
      return;
    }

    const current: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const updated: StateFile = { ...current, ...patch, updatedAt: new Date().toISOString() };

    // 原子写入
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    // 更新内存缓存
    this.activeGoals.set(goalId, updated);

    // 广播 state_change 事件到 Dashboard
    this.broadcast({
      type: 'state_change',
      timestamp: new Date().toISOString(),
      goalId,
      data: patch
    });
  }

  private findGoalStatePath(goalId: string): { statePath: string; info: RegisteredProject } | null {
    for (const [, info] of this.registeredProjects) {
      const p = path.join(info.mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(p)) {
        return { statePath: p, info };
      }
    }
    return null;
  }

  private async handleValidate(goalId: string, data?: { projectDir?: string }): Promise<any> {
    let projectDir: string;
    let mafwDir: string;
    if (data?.projectDir && this.registeredProjects.has(data.projectDir)) {
      projectDir = data.projectDir;
      mafwDir = this.registeredProjects.get(data.projectDir)!.mafwDir;
    } else {
      const first = this.registeredProjects.values().next().value;
      if (!first) throw new Error('No registered projects');
      projectDir = first.projectDir;
      mafwDir = first.mafwDir;
    }

    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
    if (fs.existsSync(statePath)) {
      throw new Error('Goal already exists');
    }

    const stateDir = path.dirname(statePath);
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
      nextAction: 'LANGGRAPH_RUNNING',
      artifacts: {},
      updatedAt: new Date().toISOString()
    };

    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    this.activeGoals.set(goalId, state);

    setImmediate(() => this.runLoopGraph(goalId, projectDir, mafwDir));

    return { success: true, goalId, nextAction: 'LANGGRAPH_RUNNING' };
  }

  private async handleComplete(goalId: string, data?: { score?: number }): Promise<any> {
    const found = this.findGoalStatePath(goalId);
    if (!found) throw new Error(`State not found for goal ${goalId}`);
    const { statePath, info } = found;

    const current: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const score = data?.score;

    let updated: StateFile;

    switch (current.phase) {
      case 'PLANNING':
        updated = {
          ...current,
          phase: 'EXECUTING',
          nextAction: 'CREATE_EXECUTE_SESSION',
          updatedAt: new Date().toISOString()
        };
        break;

      case 'EXECUTING':
        updated = {
          ...current,
          phase: 'REVIEWING',
          nextAction: 'CREATE_REVIEW_SESSION',
          updatedAt: new Date().toISOString()
        };
        break;

      case 'REVIEWING':
        if (score != null && score >= 85) {
          await this.archiveGoal(goalId);
          return { success: true, nextAction: 'COMPLETED', phase: 'ARCHIVED' };
        }
        if (score != null && score >= 60) {
          updated = {
            ...current,
            phase: 'EXECUTING',
            nextAction: 'CREATE_EXECUTE_SESSION',
            updatedAt: new Date().toISOString()
          };
        } else {
          updated = {
            ...current,
            loop: current.loop + 1,
            phase: 'PLANNING',
            nextAction: 'CREATE_PLAN_SESSION',
            updatedAt: new Date().toISOString()
          };
        }
        break;

      default:
        throw new Error(`Unknown phase: ${current.phase}`);
    }

    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
    this.activeGoals.set(goalId, updated);

    return { success: true, nextAction: updated.nextAction, phase: updated.phase };
  }

  private async loadRequest(goalId: string): Promise<any> {
    for (const [projectDir, info] of this.registeredProjects) {
      const reqPath = path.join(info.mafwDir, 'requests', `${goalId}.json`);
      if (fs.existsSync(reqPath)) {
        return JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
      }
    }
    return null;
  }

  private async runLoopGraph(goalId: string, projectDir: string, mafwDir: string) {
    const reqPath = path.join(mafwDir, 'requests', `${goalId}.json`);
    let maxRounds = 3;
    try {
      if (fs.existsSync(reqPath)) {
        const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
        maxRounds = req.maxLoops ?? 3;
      }
    } catch (err: any) {
      console.warn(`[Scheduler] Failed to read request ${reqPath}: ${err.message}, using default maxRounds=3`);
    }

    const wrap = (pDir: string, mDir: string) => ({
      planNode: async (state: any) => {
        const result = await planNode(state, { client: this.opencodeClient as SessionClient });
        this.loopSync(state, result, pDir, mDir);
        return result;
      },
      executeNode: async (state: any) => {
        const result = await executeNode(state, { client: this.opencodeClient as SessionClient });
        this.loopSync(state, result, pDir, mDir);
        return result;
      },
      reviewNode: async (state: any) => {
        const result = await reviewNode(state, { client: this.opencodeClient as SessionClient });
        this.loopSync(state, result, pDir, mDir);
        return result;
      },
      syncNode: async (state: any) => {
        const result = await syncNode(state);
        this.loopSync(state, result, pDir, mDir);
        return result;
      },
      archiveSuccess: async (state: any) => {
        syncToDashboard(state);
        console.log(`[Scheduler] Goal ${goalId} completed successfully`);
      },
      archiveFail: async (state: any) => {
        syncToDashboard(state);
        console.log(`[Scheduler] Goal ${goalId} failed`);
      },
      archiveMaxRetries: async (state: any) => {
        syncToDashboard(state);
        console.log(`[Scheduler] Goal ${goalId} max retries reached`);
      },
    });

    const graph = buildLoopGraph(wrap(projectDir, mafwDir));

    const initialState: any = {
      goalId,
      projectDir,
      mafwDir,
      round: 1,
      maxRounds,
    };

    const config = {
      configurable: { thread_id: goalId },
      checkpointer: new MemorySaver(),
    };

    try {
      await graph.invoke(initialState, config);
    } catch (err: any) {
      console.error(`[Scheduler] LangGraph invoke failed for ${goalId}: ${err.message}`);
      syncToDashboard({ goalId, projectDir, mafwDir, round: 1, maxRounds, lastError: err.message, reviewVerdict: 'ERROR' } as any);
    }
  }

  private loopSync(current: any, result: any, projectDir: string, mafwDir: string) {
    const merged = { ...current, ...result, projectDir, mafwDir };
    syncToDashboard(merged);
    this.broadcast({
      type: 'loop_transition',
      timestamp: new Date().toISOString(),
      goalId: merged.goalId,
      loopNum: merged.round,
      data: { phase: merged.phase || 'UNKNOWN' },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ── 入口 ──

if (require.main === module) {
  const scheduler = new MafwScheduler('.');

  process.on('SIGINT', () => {
    console.log('\n[Scheduler] Received SIGINT, shutting down...');
    scheduler.stop();
    process.exit(0);
  });

  scheduler.start().catch(err => {
    console.error('[Scheduler] Fatal error:', err);
    process.exit(1);
  });
}

export { MafwScheduler };
