import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { spawn, execSync, ChildProcess } from 'child_process';
// import { DashboardServer } from './dashboard/server';
import { config } from "./config";
import { installFileLogging } from './core/utils/logger';
import { buildExecutionGraph, FileCheckpointer, planNode, executeNode, reviewNode, syncToDashboard } from './core/langgraph';

import { McpSSEEndpoint } from "./mcp/sse-transport";
import { ChatSessionManager } from "./chat/chat-sessions";
import { SdkSessionResource } from "./resources/sdk-session";
import { createMemorySearch } from "./interceptors/memory-injector";
import { createToolRegistry } from "./mcp/tool-registry";
import { MemoryService } from "./memory/service";
import { CostService } from "./cost/service";
import { eventBus } from "./event-bus";
import { AutomationEngine, actionRegistry } from "./automation-engine";
import { SchedulerLedger } from "./ledger";
import { DesktopClient } from "./desktop-client";
import { QuestionLedger } from './core/manager/question-ledger';
import { ensureManagerRules } from './core/manager/system-rule-templates';
import { wakeCompletedHandler, wakeFailedHandler, wakeQuestionHandler } from './core/manager/wake-handlers';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';

/**
 * MAFW Scheduler �?v5.0 SDK 编排�?
 *
 * 核心设计原则�?
 *   - 使用 @opencode-ai/sdk 管理 Serve 进程�?Session 生命周期
 *   - 无状态业务判�? 不读�?waves.json、不解析 review、不计算 loop
 *   - 文件驱动: 只读取已注册项目�?state/{goalId}.json �?nextAction 字段
 *   - 注册表持久化: 插件注册信息写入磁盘，崩溃后可恢�?
 *   - 写队列防并发: 多个 /register 同时到达时，写磁盘串行化
 *   - 可恢�? 崩溃重启后从 state/ 文件 + 注册表恢复所有活�?Goal
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
  private serveUrl: string;
  private apiPort: number;
  private pollInterval: number;
  private projectDir: string;

  activeGoals = new Map<string, StateFile>();
  registeredProjects = new Map<string, RegisteredProject>();
  private registryPath: string;
  private registryWriteQueue: Promise<void> = Promise.resolve();
  private configPath: string;
  private configWriteQueue: Promise<void> = Promise.resolve();
  private running = true;
  // private dashboard?: DashboardServer;
  private mcpEndpoint?: McpSSEEndpoint;
  private opencodeClient: any = null;
  private sseClients: Set<http.ServerResponse> = new Set();
  private chatSessions: ChatSessionManager;
  private sdkSession!: SdkSessionResource;
  private memoryService?: MemoryService;
  private automationEngine?: AutomationEngine;
  private ledger?: SchedulerLedger;
  private mafwDir!: string;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.serveUrl = config.server.serveUrl;
    this.apiPort = config.server.apiPort;
    this.pollInterval = config.timeouts.backupPollInterval;
    this.configPath = config.paths.globalConfig;
    this.registryPath = config.paths.registryFile;
    this.chatSessions = new ChatSessionManager();
  }

  get serveRunning(): boolean {
    return !!this.serveProcess && !this.serveProcess.killed;
  }

  async start() {
    installFileLogging(path.join(os.homedir(), '.mafw', 'logs'));
    console.log('[Scheduler] MAFW Scheduler v5.0 starting...');

    // 0. Init services
    await this.initServices();
    this.setupEventBus();

    // Boot reconcile: orphan questions for inactive goals
    const bootLedger = new QuestionLedger(this.mafwDir);
    const activeCheckpoints = new Set(Array.from(this.activeGoals.keys()));
    bootLedger.bootReconcile(activeCheckpoints);

    // 1. Start HTTP API immediately (health check endpoint, MCP, etc.)
    await this.startApiServer();

    // 2. 创建 SDK 客户端（�?auth），用于健康检查和后续通信
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    const sdkConfig: Record<string, any> = { baseUrl: this.serveUrl };
    const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    this.opencodeClient = createOpencodeClient(sdkConfig);
    this.sdkSession.setClient(this.opencodeClient);
    console.log('[Scheduler] SDK client initialized');

    // 3. Background: connect to OpenCode server
    const serveUrlOverridden = !!process.env.MAFW_SERVER_SERVE_URL;
    let serveReady = false;
    if (serveUrlOverridden) {
      console.log(`[Scheduler] Using external OpenCode Serve at ${this.serveUrl}`);
      try { await this.waitForServeReady(); serveReady = true; }
      catch { console.error('[Scheduler] External OpenCode Serve not available �?MCP-only mode'); }
    } else {
      if (await this.isServeHealthy()) {
        console.log('[Scheduler] OpenCode Serve already running');
        serveReady = true;
      } else {
        try {
          await this.startServe();
          serveReady = !!this.serveProcess;
        } catch (err) {
          console.error(`[Scheduler] Failed to start OpenCode Serve: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (serveReady) {
      this.subscribeToEvents();
    }

    // 4. Dashboard is now served via the API server on the same port
    // this.dashboard = new DashboardServer(3001, this.projectDir, this);
    // this.dashboard.start();

    // 5. 恢复配置和注册表
    await this.recoverConfig();
    await this.recoverRegistry();

    // 6. 恢复活跃 Goal
    await this.recoverState();

    // 7. 启动自动化引�?
    if (this.automationEngine) {
      this.automationEngine.start();
      console.log('[Scheduler] Automation engine started');
    }

    // 8. 开始轮询（降级兜底�?
    const pollInterval = config.timeouts.backupPollInterval;
    console.log(`[Scheduler] Starting backup polling loop (${pollInterval / 1000}s)...`);
    this.startBackupPolling();

    // 9. 监听 events 目录 (替代 HTTP POST /api/events)
    this.watchEventsDir();
    // 10. 监听 registry 目录 (替代 HTTP POST /register)
    this.watchRegistryDir();
  }

  private watchEventsDir(): void {
    const eventsDir = path.join(config.resolvePath(), 'events');
    if (!fs.existsSync(eventsDir)) {
      fs.mkdirSync(eventsDir, { recursive: true });
    }
    try {
      fs.watch(eventsDir, (eventType, filename) => {
        if (!filename) return;
        const filePath = path.join(eventsDir, filename);
        try {
          if (!fs.existsSync(filePath)) return;
          if (fs.statSync(filePath).isDirectory()) return;
          const content = fs.readFileSync(filePath, 'utf-8');
          const event = JSON.parse(content);
          console.log(`[Events] Received: ${event.type} for ${event.goalId || ''}`);
          this.broadcast(event);
          if (event.goalId && this.activeGoals.has(event.goalId)) {
            setImmediate(() => this.onEvent(event.goalId));
          }
          fs.unlinkSync(filePath);
        } catch {
          // non-fatal: race condition or invalid json
        }
      });
      console.log(`[Scheduler] Watching events dir: ${eventsDir}`);
    } catch (err: any) {
      console.warn(`[Scheduler] Events dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private watchRegistryDir(): void {
    const registryDir = path.join(config.resolvePath(), 'registry');
    if (!fs.existsSync(registryDir)) {
      fs.mkdirSync(registryDir, { recursive: true });
    }
    try {
      fs.watch(registryDir, (eventType, filename) => {
        if (!filename) return;
        if (filename !== 'plugin.json') return;
        const filePath = path.join(registryDir, filename);
        try {
          if (!fs.existsSync(filePath)) return;
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content);
          const { projectDir, mafwDir } = data;
          if (!projectDir || !mafwDir) return;
          this.registeredProjects.set(projectDir, {
            projectDir,
            mafwDir,
            registeredAt: new Date().toISOString()
          });
          this.persistRegistry();
          this.persistConfig();
          console.log(`[Scheduler] Project registered via filesystem: ${projectDir}`);
        } catch {
          // non-fatal
        }
      });
      console.log(`[Scheduler] Watching registry dir: ${registryDir}`);
    } catch (err: any) {
      console.warn(`[Scheduler] Registry dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private async subscribeToEvents() {
    try {
      const stream = await this.opencodeClient.event.subscribe({});
      if (stream && typeof stream.on === 'function') {
        stream.on('data', (event: any) => {
          // Route message deltas to ChatSessionManager for SSE streaming
          const payload = event?.payload || event?.properties || event;
          const sessionID = payload?.sessionID || event?.sessionID;
          if (sessionID && this.chatSessions.hasListeners(sessionID)) {
            if (event.type === 'message.part.updated') {
              const text = payload?.part?.text || payload?.delta || '';
              if (text) this.chatSessions.pushDelta(sessionID, text);
            } else if (event.type === 'message.complete' || event.type === 'message.part.complete') {
              this.chatSessions.pushComplete(sessionID);
            } else if (event.type === 'message.error' || event.type === 'message.aborted') {
              this.chatSessions.pushError(sessionID, payload?.error || 'Unknown error');
            }
          }
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
    if (this.automationEngine) {
      this.automationEngine.stop();
    }
    // if (this.dashboard) {
    //   this.dashboard.stop();
    // }
    console.log('[Scheduler] Stopping...');
  }

  // ── Services & Event Bus ──

  private async initServices() {
    const projectDir = this.projectDir;
    const mafwDir = config.resolvePath();
    this.mafwDir = mafwDir;

    this.sdkSession = new SdkSessionResource(undefined, mafwDir);
    this.memoryService = new MemoryService(mafwDir);
    const cost = new CostService();
    this.ledger = new SchedulerLedger(projectDir);
    this.automationEngine = new AutomationEngine(mafwDir);
    this.automationEngine.setLedger(this.ledger);
    this.automationEngine.loadRules();

    actionRegistry.set('manager:report_completed', wakeCompletedHandler);
    actionRegistry.set('manager:report_failed', wakeFailedHandler);
    actionRegistry.set('manager:report_question', wakeQuestionHandler);

    const desktopClient = DesktopClient.tryLoad();
    if (desktopClient) {
      console.log('[Scheduler] Desktop automation client connected');
    }

    const services = {
      memory: this.memoryService,
      cost,
      automation: this.automationEngine,
      ledger: this.ledger,
      mafwDir,
      desktop: desktopClient || undefined,
    };

    const toolRegistry = createToolRegistry();
    this.mcpEndpoint = new McpSSEEndpoint(toolRegistry, services);

    console.log("[Scheduler] Services initialized (Memory + Cost + MCP SSE + Automation)");

    const enableLegacy = process.env[config.env.enableLegacyMcp] === "true";
    if (enableLegacy) {
      console.log("[Scheduler] Legacy MCP mode enabled �?spawning old MCP Server");
      const { spawn } = require("child_process");
      spawn("node", [path.join(__dirname, "./core/mcp-server.js")], {
        cwd: this.projectDir,
        stdio: "inherit",
      });
    }
  }

  private setupEventBus() {
    eventBus.on("goal_created", (data: any) => {
      this.broadcast({ type: "goal_created", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("state_change", (data: any) => {
      this.broadcast({ type: "state_change", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("user_question", (data: any) => {
      this.broadcast({ type: "user_question", ...data });
    });
    eventBus.on("user_feedback", (data: any) => {
      this.broadcast({ type: "user_feedback", ...data });
    });
  }

  // ── 1. Serve 管理 ──

  private async startServe() {
    const opencodeExe = resolveOpencode();
    console.log(`[Scheduler] Starting OpenCode Serve: ${opencodeExe}`);
    const port = String(config.server.servePort);
    const host = config.server.serveHost;
    this.serveProcess = spawn(opencodeExe, [
      'serve', '--port', port, '--hostname', host
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
      const delay = config.timeouts.serveRestartDelay;
      console.error(`[Scheduler] Serve exited with code ${code}, restarting in ${delay / 1000}s...`);
      this.serveProcess = undefined;
      if (this.running) {
        setTimeout(() => this.startServe(), delay);
      }
    });

    await this.waitForServeReady();
  }

  private async isServeHealthy(): Promise<boolean> {
    try {
      if (!this.opencodeClient) return false;
      const result = await this.opencodeClient.global.health();
      return true;
    } catch {
      return false;
    }
  }

  private async waitForServeReady(): Promise<void> {
    const maxRetries = config.timeouts.serveReadyMaxRetries;
    const interval = config.timeouts.serveHealthCheckInterval;
    for (let retries = 0; retries < maxRetries; retries++) {
      await this.sleep(interval);
      if (await this.isServeHealthy()) {
        console.log('[Scheduler] Serve is ready');
        return;
      }
    }
    throw new Error(`Failed to start OpenCode Serve after ${maxRetries * interval / 1000} seconds`);
  }

  // ── 2. HTTP API ──

  private async startApiServer() {
    return new Promise<void>((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          res.setHeader('Content-Type', 'application/json');

          // CORS headers for SSE
          res.setHeader("Access-Control-Allow-Origin", config.server.cors.origin);
          res.setHeader("Access-Control-Allow-Methods", config.server.cors.methods);
          res.setHeader("Access-Control-Allow-Headers", config.server.cors.headers);

          if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // MCP SSE session establishment
        if (req.url === "/mcp" && req.method === "GET") {
          try {
            await this.mcpEndpoint!.handleSSE(req, res);
          } catch (err: any) {
            console.error("[MCP SSE] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // MCP client messages
        if (req.url?.startsWith("/mcp") && req.method === "POST") {
          try {
            await this.mcpEndpoint!.handleMessage(req, res);
          } catch (err: any) {
            console.error("[MCP Message] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // Dashboard SPA (HTML + assets)
        const isSPAAsset = req.url?.startsWith("/assets/") || req.url?.startsWith("/static/");
        if (req.url === "/" || isSPAAsset || req.url === "/index.html") {
          const publicDir = config.paths.dashboardPublic;
          if (req.url === "/" || req.url === "/index.html") {
            res.setHeader("Content-Type", "text/html");
            const indexPath = path.join(publicDir, "index.html");
            if (fs.existsSync(indexPath)) {
              res.end(fs.readFileSync(indexPath, "utf-8"));
            } else {
              res.writeHead(404);
              res.end("index.html not found");
            }
          } else {
            const assetPath = path.join(publicDir, req.url!.replace("/static/", ""));
            if (fs.existsSync(assetPath)) {
              const ext = path.extname(assetPath);
              const mime: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
              res.setHeader("Content-Type", mime[ext] || 'application/octet-stream');
              res.end(fs.readFileSync(assetPath));
            } else {
              res.writeHead(404);
              res.end("not found");
            }
          }
          return;
        }

        // Chat API �?fire-and-forget promptAsync, returns sessionID for SSE streaming
        if (req.url === "/api/chat" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { message } = JSON.parse(body);
            if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }

            const firstProject = this.registeredProjects.values().next().value;
            const projectDir = firstProject?.projectDir || this.projectDir;

            if (!this.opencodeClient) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
            }

            const session = await this.opencodeClient.session.create({ query: { directory: projectDir } });
            const sessionID = session.id;

            await this.opencodeClient.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: 'text', text: message }] },
            });

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/chat/enriched �?chat with memory context injection
        if (req.url === "/api/chat/enriched" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { message } = JSON.parse(body);
            if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }

            const firstProject = this.registeredProjects.values().next().value;
            const projectDir = firstProject?.projectDir || this.projectDir;

            if (!this.opencodeClient) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
            }

            let enrichedMessage = message;
            if (this.memoryService) {
              const results = await this.memoryService.mergedSearch(message, 5);
              if (results.length > 0) {
                const deltas: string[] = [];
                const facts: string[] = [];
                for (const r of results) {
                  const line = r.source === 'parametric'
                    ? `[Δ ${r.type}] ${r.content}`
                    : `�?[${r.type}] ${r.content}`;
                  (r.source === 'parametric' ? deltas : facts).push(line);
                }
                const chunks: string[] = [];
                if (deltas.length) chunks.push('<mafw-deltas>\n' + deltas.join('\n') + '\n</mafw-deltas>');
                if (facts.length) chunks.push('<mafw-facts>\n' + facts.join('\n') + '\n</mafw-facts>');
                if (chunks.length > 0) enrichedMessage = chunks.join('\n\n') + '\n\n' + message;
              }
            }

            const session = await this.opencodeClient.session.create({ query: { directory: projectDir } });
            const sessionID = session.id;
            await this.opencodeClient.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: 'text', text: enrichedMessage }] },
            });

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/memory/merged-search �?expose memory context injection results
        if (req.url === "/api/memory/merged-search" && req.method === "GET") {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const maxFacts = parseInt(parsedUrl.searchParams.get('maxFacts') || '5', 10);
            if (!this.memoryService) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
            }
            const results = await this.memoryService.mergedSearch(query, maxFacts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/goals/{goalId}/questions/{questionId}/respond
        const respondMatch = req.url?.match(/^\/api\/goals\/([^/]+)\/questions\/([^/]+)\/respond$/);
        if (respondMatch && req.method === 'POST') {
          const goalId = respondMatch[1];
          const questionId = respondMatch[2];
          const body = await readBody(req);
          let data: any;
          try { data = JSON.parse(body); } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'bad_request', error: 'Invalid JSON' }));
            return;
          }
          const ledger = new QuestionLedger(this.mafwDir);
          const state = ledger.getQuestionState(questionId);
          if (!state) {
            res.writeHead(404);
            res.end(JSON.stringify({ status: 'not_found' }));
            return;
          }
          if (state !== 'pending') {
            res.writeHead(409);
            res.end(JSON.stringify({ status: 'conflict', currentState: state }));
            return;
          }
          if (data.type === 'cancel') {
            ledger.appendQuestionEvent({
              type: 'cancelled', questionId, goalId, cancelledAt: new Date().toISOString(),
            });
            eventBus.emit('question_cancelled', { questionId, goalId });
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'accepted', action: 'cancelled' }));
            return;
          }
          // answer or redirect
          ledger.appendQuestionEvent({
            type: 'answered', questionId, goalId,
            answer: data.answer || '', answeredAt: new Date().toISOString(),
          });
          // Resume graph
          const found = this.findGoalStatePath(goalId);
          if (found) {
            const cp = new FileCheckpointer(found.info.mafwDir);
            const graph = buildExecutionGraph(this.buildNodeOptions(found.info.mafwDir));
            graph.checkpointer = cp;
            const { Command } = await import('@langchain/langgraph');
            await graph.invoke(new Command({ resume: { answer: data.answer || '' } }) as any, {
              configurable: { thread_id: goalId },
            });
          }
          eventBus.emit('question_answered', { questionId, goalId, answer: data.answer });
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'accepted' }));
          return;
        }

        // Dashboard API
        if (req.url?.startsWith("/api/goals") || req.url?.startsWith("/api/stats") || req.url?.startsWith("/api/memory")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await this.handleDashboardAPI(req)));
          return;
        }

        // 插件注册：必须传�?projectDir + mafwDir
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

              // 直接处理控制指令（同 processControlFile 逻辑�?
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

        // POST /api/work/{goalId}/validate �?MCP calls when agent completes goal creation
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

        // POST /api/work/{goalId}/complete �?MCP calls when agent completes a phase
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

        // 健康检�?
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

        // GET /api/projects �?list registered projects
        if (req.url === '/api/projects' && req.method === 'GET') {
          const projects = Array.from(this.registeredProjects.values()).map(p => ({
            id: p.projectDir,
            worktree: p.projectDir,
          }));
          res.end(JSON.stringify({ projects }));
          return;
        }

        // GET /api/projects/current �?current/active project
        if (req.url === '/api/projects/current' && req.method === 'GET') {
          const entries = Array.from(this.registeredProjects.entries());
          if (entries.length === 0) {
            res.end(JSON.stringify({ project: null }));
            return;
          }
          const [projectDir, info] = entries[0];
          res.end(JSON.stringify({
            project: { id: projectDir, worktree: projectDir, mafwDir: info.mafwDir },
          }));
          return;
        }

        // GET /api/approvals �?list pending approvals
        if (req.url === '/api/approvals' && req.method === 'GET') {
          const approvals: any[] = [];
          // Read from .mafw/user-questions/ directories
          for (const [, info] of this.registeredProjects) {
            try {
              const qDir = path.join(info.mafwDir, 'user-questions');
              if (fs.existsSync(qDir)) {
                for (const gDir of fs.readdirSync(qDir)) {
                  const gPath = path.join(qDir, gDir);
                  if (!fs.statSync(gPath).isDirectory()) continue;
                  for (const file of fs.readdirSync(gPath).filter((f: string) => f.endsWith('.json'))) {
                    const q = JSON.parse(fs.readFileSync(path.join(gPath, file), 'utf-8'));
                    approvals.push({ id: file.replace('.json', ''), goalId: gDir, question: q.question, status: q.answered ? 'answered' : 'pending', createdAt: q.createdAt });
                  }
                }
              }
            } catch { /* ignore */ }
          }
          res.end(JSON.stringify({ approvals }));
          return;
        }

        // POST /api/approvals/{id}/respond �?respond to an approval
        const approveMatch = req.url?.match(/^\/api\/approvals\/([^/]+)\/respond$/);
        if (approveMatch && req.method === 'POST') {
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // ── Triage endpoints (Tier 4 �?user only, not MCP) ──

        // GET /api/triage �?list triage items (with llmSuggestions)
        if (req.url === '/api/triage' && req.method === 'GET') {
          const items = this.automationEngine?.getTriageItems() || [];
          res.end(JSON.stringify({ items }));
          return;
        }

        // POST /api/triage/{id}/confirm �?user confirms triage �?creates goal
        const triageConfirmMatch = req.url?.match(/^\/api\/triage\/([^/]+)\/confirm$/);
        if (triageConfirmMatch && req.method === 'POST') {
          const triageId = triageConfirmMatch[1];
          const item = this.automationEngine?.getTriageItem(triageId);
          if (!item) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'Triage item not found' })); return;
          }
          if (item.state !== 'PENDING_CONFIRMATION') {
            res.writeHead(400); res.end(JSON.stringify({ error: `Already ${item.state}` })); return;
          }
          const goalId = `confirmed-${item.automationId}-${Date.now()}`;
          this.automationEngine?.confirmTriage(goalId, item);
          const requestsDir = path.join(this.mafwDir, 'requests');
          if (!fs.existsSync(requestsDir)) fs.mkdirSync(requestsDir, { recursive: true });
          fs.writeFileSync(path.join(requestsDir, `${goalId}.json`), JSON.stringify({
            goalId,
            source: 'triage-confirm',
            automationId: item.automationId,
            title: item.proposedGoal.title,
            boundaries: item.proposedGoal.boundaries,
            maxLoops: item.proposedGoal.estimatedLoops,
            createdAt: new Date().toISOString(),
          }, null, 2), 'utf-8');
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            ruleId: item.automationId,
            goalId,
            source: 'user',
            reason: 'triage_confirmed',
          });
          res.end(JSON.stringify({ status: 'confirmed', goalId }));
          return;
        }

        // POST /api/triage/{id}/reject �?user rejects triage
        const triageRejectMatch = req.url?.match(/^\/api\/triage\/([^/]+)\/reject$/);
        if (triageRejectMatch && req.method === 'POST') {
          const triageId = triageRejectMatch[1];
          const ok = this.automationEngine?.rejectTriage(triageId);
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            source: 'user',
            reason: 'triage_rejected',
            details: { triageId },
          });
          res.end(JSON.stringify({ status: ok ? 'rejected' : 'not_found' }));
          return;
        }

        // ── Automation endpoints (Tier 4 �?user only) ──

        // GET /api/automations �?list automation rules with next trigger + recent history
        if (req.url === '/api/automations' && req.method === 'GET') {
          const rules = this.automationEngine?.getRules() || [];
          const enriched = rules.map(r => ({
            ...r,
            nextTriggers: this.automationEngine?.getNextTriggers(r).next5 || [],
            recentHistory: this.ledger?.getHistory(r.id, 3) || [],
          }));
          res.end(JSON.stringify({ rules: enriched }));
          return;
        }

        // GET /api/automations/{id} �?single rule detail
        const autoGetMatch = req.url?.match(/^\/api\/automations\/([^/]+)$/);
        if (autoGetMatch && req.method === 'GET') {
          const id = autoGetMatch[1];
          const rule = this.automationEngine?.getRule(id);
          if (!rule) { res.writeHead(404); res.end(JSON.stringify({ error: 'Rule not found' })); return; }
          res.end(JSON.stringify({
            ...rule,
            nextTriggers: this.automationEngine?.getNextTriggers(rule)?.next5 || [],
            history: this.ledger?.getHistory(id, 10) || [],
          }));
          return;
        }

        // PUT /api/automations/{id} �?toggle an automation rule (enabled/disabled)
        if (autoGetMatch && req.method === 'PUT') {
          try {
            const id = autoGetMatch[1];
            const body = await readBody(req);
            const { enabled } = JSON.parse(body);
            const ok = this.automationEngine?.toggleRule(id, enabled);
            this.ledger?.append({
              timestamp: new Date().toISOString(),
              event: 'AUTOMATION_TRIGGERED',
              ruleId: id,
              source: 'user',
              reason: enabled ? 'enabled' : 'disabled',
            });
            res.end(JSON.stringify({ status: ok ? 'toggled' : 'not_found', enabled }));
          } catch (err: any) {
            res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE /api/automations/{id} �?delete an automation rule
        if (autoGetMatch && req.method === 'DELETE') {
          const id = autoGetMatch[1];
          const ok = this.automationEngine?.deleteRule(id);
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            ruleId: id,
            source: 'user',
            reason: 'deleted',
          });
          res.end(JSON.stringify({ status: ok ? 'deleted' : 'not_found' }));
          return;
        }

        // GET /api/automations/{id}/history �?audit trail for a rule
        const autoHistoryMatch = req.url?.match(/^\/api\/automations\/([^/]+)\/history$/);
        if (autoHistoryMatch && req.method === 'GET') {
          const id = autoHistoryMatch[1];
          const limit = parseInt(new URL(req.url!, `http://${req.headers.host}`).searchParams.get('limit') || '20');
          const history = this.ledger?.getHistory(id, limit) || [];
          res.end(JSON.stringify({ history }));
          return;
        }

        // POST /api/llm/compress �?LLM compression proxy (via SDK)
        if (req.url === '/api/llm/compress' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { observations, model } = JSON.parse(body);
            if (!observations || !Array.isArray(observations)) throw new Error('observations array required');
            const result = await this.handleCompress(observations, model);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // ── SdkSessionResource REST endpoints ──

        // POST /api/session �?create a session
        if (req.url === '/api/session' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const opts = body ? JSON.parse(body) : {};
            const result = await this.sdkSession.create(opts.directory, opts.metadata);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/session/{id}/promptAsync �?fire-and-forget prompt
        const promptAsyncMatch = req.url?.match(/^\/api\/session\/([^/]+)\/promptAsync$/);
        if (promptAsyncMatch && req.method === 'POST') {
          try {
            const sessionID = promptAsyncMatch[1];
            const body = await readBody(req);
            const { message } = body ? JSON.parse(body) : {};
            if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }
            await this.sdkSession.promptAsync(sessionID, message);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/session/{id}/prompt �?synchronous prompt
        const promptMatch = req.url?.match(/^\/api\/session\/([^/]+)\/prompt$/);
        if (promptMatch && req.method === 'POST') {
          try {
            const sessionID = promptMatch[1];
            const body = await readBody(req);
            const opts = body ? JSON.parse(body) : {};
            const result = await this.sdkSession.prompt(sessionID, opts.parts || [], opts.system);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE /api/session/{id} �?delete a session
        const deleteMatch = req.url?.match(/^\/api\/session\/([^/]+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          try {
            const sessionID = deleteMatch[1];
            await this.sdkSession.delete(sessionID);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions �?list sessions (optional ?projectID=xxx)
        if (req.url?.match(/^\/api\/sessions(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const projectID = parsedUrl.searchParams.get('projectID');
            const sessions = projectID
              ? await this.sdkSession.listByProject(projectID)
              : await this.sdkSession.list();
            res.writeHead(200);
            res.end(JSON.stringify({ sessions }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions/{id} �?get session
        const sessionsGetMatch = req.url?.match(/^\/api\/sessions\/([^/]+)$/);
        if (sessionsGetMatch && req.method === 'GET') {
          try {
            const id = sessionsGetMatch[1];
            const session = await this.sdkSession.get(id);
            res.writeHead(200);
            res.end(JSON.stringify(session || { error: 'not found' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions/{id}/messages �?fetch session message history via SDK
        const messagesMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/);
        if (messagesMatch && req.method === 'GET') {
          try {
            const id = messagesMatch[1];
            if (!this.opencodeClient) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'OpenCode client not available' }));
              return;
            }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
            const result = await this.opencodeClient.session.messages({ path: { id }, query: { limit } });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.data || result));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // SSE 事件�?(�?Dashboard / Chat)
        if (req.url && req.url.startsWith('/api/events') && req.method === 'GET') {
          const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
          const sessionID = parsedUrl.searchParams.get('sessionID');

          if (sessionID) {
            // Mode B: subscribe to specific chat session's delta events
            this.chatSessions.register(sessionID, res);
          } else {
            // Mode A: subscribe to global event stream (Dashboard)
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });
            res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
            this.sseClients.add(res);
            req.on('close', () => { this.sseClients.delete(res); });
          }
          return;
        }

        // GET /health �?standalone health endpoint (not proxied)
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Reverse proxy to opencode server for non-MAFW routes
        const serveUrl = config.server.serveUrl;
        try {
          const proxyUrl = new URL(req.url || '/', serveUrl);
          const proxyReq = http.request(proxyUrl, {
            method: req.method,
            headers: { ...req.headers, host: proxyUrl.host },
          }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (err) => {
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
          });
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.pipe(proxyReq);
          } else {
            proxyReq.end();
          }
        } catch (err: any) {
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Proxy config error: ' + err.message }));
        }
      } catch (err: any) {
        console.error('[Scheduler] Unhandled request error:', err.message);
        if (!res.headersSent) {
          try { res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
          } catch { /* response already ended */ }
        }
      }
      });

      server.listen(this.apiPort, () => {
        console.log(`[Scheduler] HTTP API on port ${this.apiPort}`);
        console.log(`[Scheduler]  - POST /register  { projectDir, mafwDir }`);
        console.log(`[Scheduler]  - POST /control  { action, goalId, ... }`);
        console.log(`[Scheduler]  - GET  /health`);
        console.log(`[Scheduler]  - GET  /mcp           (MCP SSE)`);
        console.log(`[Scheduler]  - POST /mcp           (MCP messages)`);
        console.log(`[Scheduler]  - POST /api/llm/compress (LLM compression)`);
        console.log(`[Scheduler]  - GET  /              (Dashboard SPA)`);
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

  // ── 4. 轮询（降级兜�?+ autoresume�?──

  private startBackupPolling() {
    const interval = config.timeouts.backupPollInterval;
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.discoverNewGoals();
        await this.resumeStaleThreads();
      } catch (err: any) {
        console.error('[Scheduler] Backup poll error:', err.message);
      }
      setTimeout(poll, interval);
    };
    setTimeout(poll, interval);
  }

  // 轮询已注册项目的 state/ 目录
  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      // 清理 stale entry（项目目录已删除�?
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
            // 更新缓存中的状�?
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

  // ── 工具函数（使�?SDK 客户端） ──

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

    // 广播 state_change 事件�?Dashboard
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
      version: '2', goalId, loop: 1, phase: 'PLANNING',
      lastPhase: null, currentWave: 0, totalWaves: null,
      sessions: {}, nextAction: 'GRAPH_INVOKED', artifacts: {},
      updatedAt: new Date().toISOString()
    };

    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    this.activeGoals.set(goalId, state);

    // 立即触发 graph invoke（事件驱动）
    setImmediate(() => this.onGoalCreated(goalId, projectDir, mafwDir));

    return { success: true, goalId, nextAction: 'GRAPH_INVOKED' };
  }

  private async handleComplete(goalId: string, data?: { score?: number }): Promise<any> {
    setImmediate(() => this.onEvent(goalId));
    return { success: true, nextAction: 'SCHEDULED' };
  }

  private async handleCompress(observations: string[], model?: string): Promise<any> {
    const prompt = `Analyze the following agent observations and extract structured memories.
Return JSON only:
{
  "narrative": "summary of what happened",
  "facts": ["specific fact 1", "specific fact 2"],
  "concepts": ["keyword1", "keyword2"],
  "energy": 0.5
}

Observations:
${observations.map((o, i) => `[${i + 1}] ${o}`).join('\n')}`;

    const systemPrompt = 'You are a memory compression system. Extract structured memories from observations. Return ONLY valid JSON.';

    if (!this.opencodeClient) {
      return { narrative: 'No LLM client available', facts: [], concepts: [], energy: 0.3 };
    }

    let sessionId: string | null = null;
    try {
      const session = await this.opencodeClient.session.create({ query: { directory: this.projectDir } });
      sessionId = session.id;
      const result = await this.opencodeClient.session.prompt({
        path: { id: session.id },
        body: {
          parts: [{ type: 'text', text: prompt }],
          system: systemPrompt,
          noReply: false,
          ...(model ? { model: { providerID: 'opencode', modelID: model } } : {}),
        }
      });
      const text = result.parts
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n') || '';
      return this.parseLLMResponse(text);
    } catch (err: any) {
      return { narrative: 'Compression failed: ' + err.message, facts: [], concepts: [], energy: 0.3 };
    } finally {
      if (sessionId) {
        try { await this.opencodeClient.session.delete({ path: { id: sessionId } }); } catch {}
      }
    }
  }

  private parseLLMResponse(text: string): any {
    try {
      const parsed = JSON.parse(text);
      return {
        narrative: parsed.narrative || '',
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        energy: typeof parsed.energy === 'number' ? parsed.energy : 0.5
      };
    } catch {
      return { narrative: text.slice(0, 200), facts: [], concepts: [], energy: 0.5 };
    }
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

  // ── LangGraph Node Options ──

  private createInProcessClient(): { session: { create(opts: { directory: string }): Promise<{ id: string }>; promptAsync(opts: { sessionID: string; message: string }): Promise<void>; delete(opts: { sessionID: string }): Promise<void> } } {
    const resource = this.sdkSession;

    let promptAsync: (opts: { sessionID: string; message: string }) => Promise<void>;

    if (this.memoryService) {
      const memorySearch = createMemorySearch(
        this.memoryService.parametricStore,
        this.memoryService.deltaInjector,
        this.memoryService.harmonicIndex,
      );
      const wrapped = resource.createPromptAsyncWithInjection(memorySearch);
      promptAsync = async (opts) => wrapped(opts.sessionID, opts.message);
    } else {
      promptAsync = async (opts) => resource.promptAsync(opts.sessionID, opts.message);
    }

    return {
      session: {
        create: async (opts) => resource.create(opts.directory),
        promptAsync,
        delete: async (opts) => resource.delete(opts.sessionID),
      },
    };
  }

  private buildNodeOptions(mafwDir: string) {
    const syncToFile = (state: any) => {
      syncToDashboard({ ...state, mafwDir });
    };
    const client = this.createInProcessClient();
    return {
      plan: async (s: any) => planNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
      }),
      askUser: async (s: any) => {
        syncToFile({ ...s, pendingQuestion: null, phase: 'ASKING_USER', mafwDir });
        return { pendingQuestion: null };
      },
      execute: async (s: any) => executeNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
      }),
      review: async (s: any) => reviewNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
      }),
      archiveSuccess: async (s: any) => {
        console.log(`[Scheduler] Goal ${s.goalId} PASSED`);
        syncToFile({ ...s, phase: 'ARCHIVED' });
        await this.archiveGoal(s.goalId);
        return {};
      },
      archiveFail: async (s: any) => {
        console.error(`[Scheduler] Goal ${s.goalId} FAILED: ${s.lastError}`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId);
        return {};
      },
      archiveMaxRetries: async (s: any) => {
        console.error(`[Scheduler] Goal ${s.goalId} max retries`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId);
        return {};
      },
    };
  }

  private async initLangChainTools() {
    try {
      const mcpClient = new MultiServerMCPClient({
        "mafw-server": {
          url: config.server.mcpUrl,
          transport: "sse",
        },
      });
      const tools = await mcpClient.getTools();
      console.log(`[LangChain] Loaded ${tools.length} MCP tools`);
      return tools;
    } catch (err) {
      console.warn('[LangChain] MCP client init failed (non-fatal):', err);
      return [];
    }
  }

  private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
    const cp = new FileCheckpointer(mafwDir);
    const graph = buildExecutionGraph(this.buildNodeOptions(mafwDir));
    graph.checkpointer = cp;
    const initialState: any = {
      goalId, projectDir, mafwDir,
      round: config.loop.initialRound, maxRounds: config.loop.maxRounds,
      wavePlanPath: null, receiptPath: null,
      reviewVerdict: 'FAIL' as const,
      reviewReportPath: null, reviewFeedback: '', lastError: null,
    };
    await graph.invoke(initialState, {
      configurable: { thread_id: goalId },
    });
  }

  private async onEvent(goalId: string) {
    const found = this.findGoalStatePath(goalId);
    if (!found) return;
    const { info } = found;
    const cp = new FileCheckpointer(info.mafwDir);
    const current = await cp.getCurrentState(goalId);
    if (!current || ['ARCHIVED', 'FAILED'].includes(current.phase)) return;

    const graph = buildExecutionGraph(this.buildNodeOptions(info.mafwDir));
    graph.checkpointer = cp;
    await graph.invoke(null, {
      configurable: { thread_id: goalId },
    });
    await this.syncFromCheckpoint(goalId, cp);
  }

  private async syncFromCheckpoint(goalId: string, cp: FileCheckpointer) {
    const current = await cp.getCurrentState(goalId);
    if (!current) return;
    syncToDashboard({
      goalId, round: current.round,
      phase: current.phase,
      reviewVerdict: current.verdict,
      lastError: current.lastError || null,
    } as any);
  }

  private async resumeStaleThreads() {
    for (const [, info] of this.registeredProjects) {
      const checkpointsDir = path.join(info.mafwDir, 'checkpoints');
      if (!fs.existsSync(checkpointsDir)) continue;
      const threads = fs.readdirSync(checkpointsDir);
      for (const threadId of threads) {
        if (!this.activeGoals.has(threadId)) {
          const cp = new FileCheckpointer(info.mafwDir);
          const state = await cp.getCurrentState(threadId);
          if (state && state.phase !== 'ARCHIVED' && state.phase !== 'FAILED') {
            console.log(`[Scheduler] Resuming stale thread ${threadId}`);
            await this.onEvent(threadId);
          }
        }
      }
    }
  }

  private async handleDashboardAPI(req: http.IncomingMessage): Promise<any> {
    if (req.url?.startsWith("/api/goals")) {
      return {
        goals: Array.from(this.activeGoals.values()).map(s => ({
          goalId: s.goalId,
          phase: s.phase,
          loop: s.loop,
          nextAction: s.nextAction,
          error: s.error || null,
          updatedAt: s.updatedAt,
        })),
      };
    }
    if (req.url?.startsWith("/api/stats")) {
      return {
        activeGoals: this.activeGoals.size,
        registeredProjects: this.registeredProjects.size,
        sseClients: this.sseClients.size,
        serveRunning: this.serveRunning,
      };
    }
    if (req.url?.startsWith("/api/memory")) {
      return { status: "ok", message: "Memory API not yet implemented" };
    }
    return { error: "Unknown endpoint" };
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
