import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { spawn, execSync } from 'child_process';
// import { DashboardServer } from './dashboard/server';
import { config } from "./config";
import { log } from './core/utils/logger';
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
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from './skills/manager-identity';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';

/**
 * MAFW Scheduler 锟?v5.0 SDK 缂栨帓锟?
 *
 * 鏍稿績璁捐鍘熷垯锟?
 *   - 浣跨敤 @opencode-ai/sdk 绠＄悊 Serve 杩涚▼锟?Session 鐢熷懡鍛ㄦ湡
 *   - 鏃犵姸鎬佷笟鍔″垽锟? 涓嶈锟?waves.json銆佷笉瑙ｆ瀽 review銆佷笉璁＄畻 loop
 *   - 鏂囦欢椹卞姩: 鍙鍙栧凡娉ㄥ唽椤圭洰锟?state/{goalId}.json 锟?nextAction 瀛楁
 *   - 娉ㄥ唽琛ㄦ寔涔呭寲: 鎻掍欢娉ㄥ唽淇℃伅鍐欏叆纾佺洏锛屽穿婧冨悗鍙仮锟?
 *   - 鍐欓槦鍒楅槻骞跺彂: 澶氫釜 /register 鍚屾椂鍒拌揪鏃讹紝鍐欑鐩樹覆琛屽寲
 *   - 鍙仮锟? 宕╂簝閲嶅惎鍚庝粠 state/ 鏂囦欢 + 娉ㄥ唽琛ㄦ仮澶嶆墍鏈夋椿锟?Goal
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

// Normalize a directory path for comparison: lowercase + forward slashes
// (Windows drives/case differences must not split sessions across projects).
function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`).toString();
      const match = out.match(/LISTENING\s+(\d+)/);
      const pid = match ? Number(match[1]) : null;
      if (pid) process.kill(pid, 'SIGTERM');
    } else {
      const out = execSync(`lsof -ti:${port}`).toString().trim();
      const pid = Number(out) || null;
      if (pid) process.kill(pid, 'SIGTERM');
    }
  } catch { /* port is free */ }
}

async function isPortHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

class MafwScheduler {
  private serveInstance?: { url: string; close: () => void };
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
  private managerSessionInfo: { sessionId: string; projectDir: string; createdAt: string } | null = null;

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
    return !!this.serveInstance;
  }

  async start() {
    log.info('MAFW Scheduler v5.0 starting...');

    // Single-instance guard: if a healthy gateway already owns apiPort, this
    // instance is redundant — exit before spawning anything (avoids two
    // gateways fighting over ports 3000/4096).
    if (await isPortHealthy(this.apiPort)) {
      log.info(`[Scheduler] Another gateway already running on port ${this.apiPort}; exiting`);
      process.exit(0);
      return;
    }

    // 0. Init services
    await this.initServices();
    this.setupEventBus();

    // Boot reconcile: orphan questions for inactive goals
    const bootLedger = new QuestionLedger(this.mafwDir);
    const activeCheckpoints = new Set(Array.from(this.activeGoals.keys()));
    bootLedger.bootReconcile(activeCheckpoints);

    // 1. Start HTTP API immediately (health check endpoint, MCP, etc.)
    await this.startApiServer();

    // 2. 鍒涘缓 SDK 瀹㈡埛绔紙锟?auth锛夛紝鐢ㄤ簬鍋ュ悍妫€鏌ュ拰鍚庣画閫氫俊
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    const sdkConfig: Record<string, any> = { baseUrl: this.serveUrl };
    const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    this.opencodeClient = createOpencodeClient(sdkConfig);
    this.sdkSession.setClient(this.opencodeClient);
    log.info('SDK client initialized');

    // 3. Background: connect to OpenCode server
    const serveUrlOverridden = !!process.env.MAFW_SERVER_SERVE_URL;
    let serveReady = false;
    if (serveUrlOverridden) {
      log.info(`[Scheduler] Using external OpenCode Serve at ${this.serveUrl}`);
      try { await this.waitForServeReady(); serveReady = true; }
      catch { log.warn('External OpenCode Serve not available 锟?MCP-only mode'); }
    } else {
      if (await this.isServeHealthy()) {
        log.info('OpenCode Serve already running');
        serveReady = true;
      } else {
        log.info('OpenCode Serve not reachable, checking for stale process...');
        killProcessOnPort(config.server.servePort);
        try {
          await this.startServe();
          serveReady = !!this.serveInstance;
        } catch (err) {
          log.error(`Failed to start OpenCode Serve: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (serveReady) {
      this.subscribeToEvents();
    }

    // 4. Dashboard is now served via the API server on the same port
    // this.dashboard = new DashboardServer(3001, this.projectDir, this);
    // this.dashboard.start();

    // 5. 鎭㈠閰嶇疆鍜屾敞鍐岃〃
    await this.recoverConfig();
    await this.recoverRegistry();

    // 6. 鎭㈠娲昏穬 Goal
    await this.recoverState();

    // 7. 涓烘墍鏈夊凡娉ㄥ唽椤圭洰鍒濆鍖?Manager session锛堜笉瀛樺湪鍒欒嚜鍔ㄥ垱寤猴級
    for (const [projectDir, info] of this.registeredProjects) {
      try {
        await this.ensureManagerSession(projectDir, info.mafwDir);
      } catch (err: any) {
        log.warn(`[Scheduler] Manager session init failed for ${projectDir}: ${err.message}`);
      }
    }

    // 8. 鍚姩鑷姩鍖栧紩锟?
    if (this.automationEngine) {
      this.automationEngine.start();
      log.info('[Scheduler] Automation engine started');
    }

    // 8. 寮€濮嬭疆璇紙闄嶇骇鍏滃簳锟?
    const pollInterval = config.timeouts.backupPollInterval;
    log.info(`[Scheduler] Starting backup polling loop (${pollInterval / 1000}s)...`);
    this.startBackupPolling();

    // 9. 鐩戝惉 events 鐩綍 (鏇夸唬 HTTP POST /api/events)
    this.watchEventsDir();
    // 10. 鐩戝惉 registry 鐩綍 (鏇夸唬 HTTP POST /register)
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
          log.info(`[Events] Received: ${event.type} for ${event.goalId || ''}`);
          this.broadcast(event);
          if (event.goalId && this.activeGoals.has(event.goalId)) {
            setImmediate(() => this.onEvent(event.goalId));
          }
          fs.unlinkSync(filePath);
        } catch {
          // non-fatal: race condition or invalid json
        }
      });
      log.info(`[Scheduler] Watching events dir: ${eventsDir}`);
    } catch (err: any) {
      log.warn(`[Scheduler] Events dir watch failed (non-fatal): ${err.message}`);
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
          log.info(`[Scheduler] Project registered via filesystem: ${projectDir}`);
        } catch {
          // non-fatal
        }
      });
      log.info(`[Scheduler] Watching registry dir: ${registryDir}`);
    } catch (err: any) {
      log.warn(`[Scheduler] Registry dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private async subscribeToEvents() {
    try {
      // Use /global/event (GlobalEvent = { directory, payload }) so we receive
      // events from ALL workspaces — /event only delivers the current
      // request-scoped workspace, missing sessions in other project dirs.
      const result = await this.opencodeClient.global.event({});
      // SDK SSE client returns { stream } where stream is an async generator
      const stream = result?.stream ?? result;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        log.warn('[Scheduler] SDK event subscribe returned no async stream');
        return;
      }
      log.info('[Scheduler] Subscribed to OpenCode events');
      void (async () => {
        try {
          for await (const evt of stream) this.handleOpencodeEvent(evt);
        } catch (err: any) {
          log.warn(`[Scheduler] OpenCode event stream ended: ${err.message}`);
        }
      })();
    } catch (err: any) {
      log.warn(`[Scheduler] SDK event subscribe failed (non-fatal): ${err.message}`);
    }
  }

  private handleOpencodeEvent(evt: any): void {
    // GlobalEvent shape: { directory, payload: { id, type, properties } }
    const payload = evt?.payload || {};
    const type = payload?.type || evt?.type;
    const props = payload?.properties || evt?.properties || {};
    const sessionID = props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;
    log.info(`[SSE] opencode event: ${type} sessionID=${sessionID}`);

    // Per-session SSE (Mode B) forwarding
    if (sessionID && this.chatSessions.hasListeners(sessionID)) {
      if (type === 'message.part.updated') {
        const text = props?.part?.text || props?.delta || '';
        if (text) this.chatSessions.pushDelta(sessionID, text);
      } else if (type === 'session.idle' || type === 'message.updated') {
        this.chatSessions.pushComplete(sessionID);
      } else if (type === 'session.error' || type === 'message.error') {
        this.chatSessions.pushError(sessionID, props?.error || 'Unknown error');
      }
    }

    // Global broadcast (Mode A — used by the desktop renderer).
    // Normalize to the renderer's contract: { type, properties, sessionID }.
    if (type === 'session.idle') {
      this.broadcast({ type: 'opencode_event', data: { type: 'message.complete', sessionID } });
    } else if (type === 'session.error') {
      this.broadcast({ type: 'opencode_event', data: { type: 'message.error', sessionID, error: props?.error } });
    } else {
      this.broadcast({ type: 'opencode_event', data: { type, properties: props, sessionID } });
    }
  }

  private broadcast(event: { type: string; [key: string]: any }): void {
    log.info(`[SSE] broadcast ${event.type} clients=${this.sseClients.size}`);
    const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(data); } catch { this.sseClients.delete(client); }
    }  }

  stop() {
    this.running = false;
    if (this.serveInstance) {
      this.serveInstance.close();
      this.serveInstance = undefined;
    }
    if (this.automationEngine) {
      this.automationEngine.stop();
    }
    // if (this.dashboard) {
    //   this.dashboard.stop();
    // }
    log.info('[Scheduler] Stopping...');
  }

  // Proxy a native opencode request by trying every registered workspace.
  // Native reply/reject routes are workspace-scoped (WorkspaceRoutingMiddleware),
  // but the gateway's own projectDir is its cwd — the request may belong to any
  // registered project. GET list endpoints are cross-workspace and unaffected.
  private async proxyNativeWorkspaces(path: string, method: string, body?: any): Promise<{ ok: boolean; status: number }> {
    const dirs = new Set<string>([this.projectDir || '.']);
    for (const key of this.registeredProjects.keys()) dirs.add(key);
    let lastStatus = 502;
    for (const dir of dirs) {
      try {
        const r = await fetch(`${this.serveUrl}${path}?directory=${encodeURIComponent(dir)}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(dir) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (r.ok) return { ok: true, status: r.status };
        lastStatus = r.status;
      } catch (e: any) {
        log.error(`[Native proxy] ${path} failed for ${dir}: ${e.message}`);
      }
    }
    return { ok: false, status: lastStatus };
  }

  // 鈹€鈹€ Services & Event Bus 鈹€鈹€

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
    ensureManagerRules(mafwDir);
    this.automationEngine.loadRules();

    actionRegistry.set('manager:report_completed', wakeCompletedHandler);
    actionRegistry.set('manager:report_failed', wakeFailedHandler);
    actionRegistry.set('manager:report_question', wakeQuestionHandler);

    const desktopClient = DesktopClient.tryLoad();
    if (desktopClient) {
      log.info('[Scheduler] Desktop automation client connected');
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

    log.info("[Scheduler] Services initialized (Memory + Cost + MCP SSE + Automation)");

    const enableLegacy = process.env[config.env.enableLegacyMcp] === "true";
    if (enableLegacy) {
      log.info("[Scheduler] Legacy MCP mode enabled 锟?spawning old MCP Server");
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
    eventBus.on("phase_transition", (data: any) => {
      this.broadcast({ type: "phase_transition", ...data });
    });
    eventBus.on("memory_written", (data: any) => {
      this.broadcast({ type: "memory_written", ...data });
    });
    eventBus.on("memory_energy_changed", (data: any) => {
      this.broadcast({ type: "memory_energy_changed", ...data });
    });
    eventBus.on("memory_distillation_complete", (data: any) => {
      this.broadcast({ type: "memory_distillation_complete", ...data });
    });
    eventBus.on("automation_triggered", (data: any) => {
      this.broadcast({ type: "automation_triggered", ...data });
    });
    eventBus.on("automation_completed", (data: any) => {
      this.broadcast({ type: "automation_completed", ...data });
    });
  }

  private async startServe() {
    log.info('Starting OpenCode Serve via SDK...');
    const port = config.server.servePort;
    const host = config.server.serveHost;
    try {
      const { createOpencodeServer } = await import('@opencode-ai/sdk');
      const instance = await createOpencodeServer({
        hostname: host,
        port,
      });
      this.serveInstance = instance;
      log.info(`OpenCode Serve started at ${instance.url}`);
    } catch (err: any) {
      log.error(`Failed to start OpenCode Serve: ${err.message}`);
      throw err;
    }
  }

  private async listSessions(projectID: string | null): Promise<any[]> {
    // Try SDK first (opencode server), fall back to local store
    if (this.opencodeClient) {
      try {
        const result = await this.opencodeClient.session.list(projectID ? { query: { directory: projectID } } : undefined);
        const sessions = Array.isArray(result) ? result : result?.data;
        if (sessions && Array.isArray(sessions)) {
          // Enrich SDK sessions with local metadata (manager session markers, etc.)
          const localSessions = await this.sdkSession.list();
          const localMap = new Map(localSessions.map(s => [s.id, s]));
          const enriched = sessions.map((s: any) => {
            const local = localMap.get(s.id);
            return local?.metadata ? { ...s, metadata: local.metadata } : s;
          });
          // Also include local-only sessions (e.g. Manager session registered via
          // registerExternal) that the opencode server doesn't know about — but only
          // those belonging to the queried project, so switching projects shows only
          // that project's manager session.
          const sdkIds = new Set<string>(sessions.map((s: any) => s.id));
          const missingLocal = localSessions.filter(s => s.metadata && !sdkIds.has(s.id));
          if (missingLocal.length > 0) {
            const targetDir = projectID ? normalizeDir(projectID) : null;
            enriched.push(...missingLocal
              .filter(s => !targetDir || normalizeDir(s.directory || s.projectID || '') === targetDir)
              .map(s => ({
                id: s.id,
                projectID: s.projectID,
                directory: s.directory,
                title: s.title,
                metadata: s.metadata,
                time: s.time,
              })));
          }
          return enriched;
        }
      } catch {}
    }
    return projectID ? await this.sdkSession.listByProject(projectID) : await this.sdkSession.list();
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
        log.info('[Scheduler] Serve is ready');
        return;
      }
    }
    throw new Error(`Failed to start OpenCode Serve after ${maxRetries * interval / 1000} seconds`);
  }

  // 鈹€鈹€ 2. HTTP API 鈹€鈹€

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
            log.error("[MCP SSE] Error:", err.message);
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
            log.error("[MCP Message] Error:", err.message);
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

        // Chat API 锟?fire-and-forget promptAsync, returns sessionID for SSE streaming
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
            const sessionID = session.data?.id ?? session.id;
            if (!sessionID) {
              res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
            }

            const result = await this.opencodeClient.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: 'text', text: message }] },
            });
            if (result?.error) {
              log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
              return;
            }
            log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/chat/enriched 锟?chat with memory context injection
        if (req.url === "/api/chat/enriched" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { message, sessionID: existingID } = JSON.parse(body);
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
                    ? `[螖 ${r.type}] ${r.content}`
                    : `锟?[${r.type}] ${r.content}`;
                  (r.source === 'parametric' ? deltas : facts).push(line);
                }
                const chunks: string[] = [];
                if (deltas.length) chunks.push('<mafw-deltas>\n' + deltas.join('\n') + '\n</mafw-deltas>');
                if (facts.length) chunks.push('<mafw-facts>\n' + facts.join('\n') + '\n</mafw-facts>');
                if (chunks.length > 0) enrichedMessage = chunks.join('\n\n') + '\n\n' + message;
              }
            }

            const sessionID = existingID || (await this.opencodeClient.session.create({ query: { directory: projectDir } })).data?.id;
            if (!sessionID) {
              res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
            }
            const result = await this.opencodeClient.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: 'text', text: enrichedMessage }] },
            });
            if (result?.error) {
              log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
              return;
            }
            log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/memory/merged-search 锟?expose memory context injection results
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

        // 鎻掍欢娉ㄥ唽锛氬繀椤讳紶锟?projectDir + mafwDir
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

              // Never register the user's home directory (or its standard data
              // folders) as a project — desktop's opencode server plugin activates
              // with cwd=$HOME (or a folder under it) and would otherwise pollute
              // the registry with bogus "projects" (and manager sessions).
              if (this.isUserDataDir(projectDir)) {
                log.warn(`[Scheduler] Refusing to register user data directory as project: ${projectDir}`);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'User data directory cannot be a project' }));
                return;
              }

              this.registeredProjects.set(projectDir, {
                projectDir,
                mafwDir,
                registeredAt: new Date().toISOString()
              });

              // 鎸佷箙鍖栧埌纾佺洏锛堝啓闃熷垪闃插苟鍙戣鐩栵級
              await this.persistRegistry();
              await this.persistConfig();

              if (this.opencodeClient) {
                try {
                  await this.ensureManagerSession(projectDir, mafwDir);
                } catch (err: any) {
                  log.warn(`[Scheduler] Manager session bootstrap failed: ${err.message} (non-fatal)`);
                }
              }

              log.info(`[Scheduler] Project registered: ${projectDir}`);
              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok', registered: projectDir }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // 鎺у埗鎸囦护
        if (req.url === '/control' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const control = JSON.parse(body);
              log.info(`[Scheduler] HTTP control: ${control.action} ${control.goalId || ''}`);

              // 鐩存帴澶勭悊鎺у埗鎸囦护锛堝悓 processControlFile 閫昏緫锟?
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
                  log.info('[Scheduler] Resetting parametric cache...');
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

        // POST /api/work/{goalId}/validate 锟?MCP calls when agent completes goal creation
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

        // POST /api/work/{goalId}/complete 锟?MCP calls when agent completes a phase
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

        // GET /api/manager/session 鈥?return manager session info
        if (req.url === '/api/manager/session' && req.method === 'GET') {
          if (!this.managerSessionInfo) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'No manager session' }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify(this.managerSessionInfo));
          return;
        }

        // 鍋ュ悍妫€锟?
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            serveRunning: !!this.serveInstance,
            registeredProjects: Array.from(this.registeredProjects.keys()),
            activeGoals: Array.from(this.activeGoals.keys())
          }));
          return;
        }

        // GET /api/projects 锟?list registered projects
        if (req.url === '/api/projects' && req.method === 'GET') {
          const projects = Array.from(this.registeredProjects.values()).map(p => ({
            id: p.projectDir,
            worktree: p.projectDir,
          }));
          res.end(JSON.stringify({ projects }));
          return;
        }

        // GET /api/projects/current 锟?current/active project
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

        // GET /api/approvals 锟?list pending approvals
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

        // POST /api/approvals/{id}/respond 锟?respond to an approval
        const approveMatch = req.url?.match(/^\/api\/approvals\/([^/]+)\/respond$/);
        if (approveMatch && req.method === 'POST') {
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // 鈹€鈹€ Question endpoints (AskCard 鈹€ proxy to native opencode Question API) 鈹€鈹€

        // GET /api/questions 鈹€ list pending questions
        if (req.url?.match(/^\/api\/questions(?:\?|$)/) && req.method === 'GET') {
          try {
            const dir = new URL(req.url, this.serveUrl).searchParams.get('directory') || this.projectDir || '.';
            const r = await fetch(`${this.serveUrl}/question?directory=${encodeURIComponent(dir)}`, {
              headers: { 'x-opencode-directory': encodeURIComponent(dir) },
            });
            const items = await r.json();
            res.end(JSON.stringify({ items }));
          } catch (err: any) {
            log.error('[Question] list error:', err.message);
            res.end(JSON.stringify({ items: [] }));
          }
          return;
        }

        // POST /api/questions/{id}/reply 鈹€ { answers: string[][] }
        const qReplyMatch = req.url?.match(/^\/api\/questions\/([^/]+)\/reply(?:\?|$)/);
        if (qReplyMatch && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const r = await this.proxyNativeWorkspaces(`/question/${qReplyMatch[1]}/reply`, 'POST', { answers: body.answers });
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Question] reply error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // POST /api/questions/{id}/reject
        const qRejectMatch = req.url?.match(/^\/api\/questions\/([^/]+)\/reject(?:\?|$)/);
        if (qRejectMatch && req.method === 'POST') {
          try {
            const r = await this.proxyNativeWorkspaces(`/question/${qRejectMatch[1]}/reject`, 'POST');
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Question] reject error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ Permission endpoints (PermissionCard 鈹€ proxy to native opencode Permission API) 鈹€鈹€

        // GET /api/permissions 鈹€ list pending permission requests
        if (req.url?.match(/^\/api\/permissions(?:\?|$)/) && req.method === 'GET') {
          try {
            const dir = new URL(req.url, this.serveUrl).searchParams.get('directory') || this.projectDir || '.';
            const r = await fetch(`${this.serveUrl}/permission?directory=${encodeURIComponent(dir)}`, {
              headers: { 'x-opencode-directory': encodeURIComponent(dir) },
            });
            const items = await r.json();
            res.end(JSON.stringify({ items }));
          } catch (err: any) {
            log.error('[Permission] list error:', err.message);
            res.end(JSON.stringify({ items: [] }));
          }
          return;
        }

        // POST /api/permissions/{id}/reply 鈹€ { reply: 'once'|'always'|'reject', message?: string }
        const pReplyMatch = req.url?.match(/^\/api\/permissions\/([^/]+)\/reply(?:\?|$)/);
        if (pReplyMatch && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const payload: any = { reply: body.reply };
            if (body.message) payload.message = body.message;
            const r = await this.proxyNativeWorkspaces(`/permission/${pReplyMatch[1]}/reply`, 'POST', payload);
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Permission] reply error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ Triage endpoints (Tier 4 锟?user only, not MCP) 鈹€鈹€

        // GET /api/triage 锟?list triage items (with llmSuggestions)
        if (req.url === '/api/triage' && req.method === 'GET') {
          const items = this.automationEngine?.getTriageItems() || [];
          res.end(JSON.stringify({ items }));
          return;
        }

        // POST /api/triage/{id}/confirm 锟?user confirms triage 锟?creates goal
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

        // POST /api/triage/{id}/reject 锟?user rejects triage
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

        // 鈹€鈹€ Automation endpoints (Tier 4 锟?user only) 鈹€鈹€

        // GET /api/automations 锟?list automation rules with next trigger + recent history
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

        // GET /api/automations/{id} 锟?single rule detail
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

        // PUT /api/automations/{id} 锟?toggle an automation rule (enabled/disabled)
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

        // DELETE /api/automations/{id} 锟?delete an automation rule
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

        // GET /api/automations/{id}/history 锟?audit trail for a rule
        const autoHistoryMatch = req.url?.match(/^\/api\/automations\/([^/]+)\/history$/);
        if (autoHistoryMatch && req.method === 'GET') {
          const id = autoHistoryMatch[1];
          const limit = parseInt(new URL(req.url!, `http://${req.headers.host}`).searchParams.get('limit') || '20');
          const history = this.ledger?.getHistory(id, limit) || [];
          res.end(JSON.stringify({ history }));
          return;
        }

        // POST /api/llm/compress 锟?LLM compression proxy (via SDK)
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

        // 鈹€鈹€ SdkSessionResource REST endpoints 鈹€鈹€

        // POST /api/session 锟?create a session
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

        // POST /api/session/{id}/promptAsync 锟?fire-and-forget prompt
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

        // POST /api/session/{id}/prompt 锟?synchronous prompt
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

        // DELETE /api/session/{id} 锟?delete a session
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

        // POST /api/session/{id}/abort 鈥?abort an in-flight run
        const abortMatch = req.url?.match(/^\/api\/session\/([^/]+)\/abort$/);
        if (abortMatch && req.method === 'POST') {
          try {
            const sessionID = abortMatch[1];
            if (!this.opencodeClient) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'LLM client not available' }));
              return;
            }
            await this.opencodeClient.session.abort({ path: { id: sessionID } });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions 锟?list sessions (optional ?projectID=xxx)
        if (req.url?.match(/^\/api\/sessions(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const projectID = parsedUrl.searchParams.get('projectID');
            const sessions = await this.listSessions(projectID);
            res.writeHead(200);
            res.end(JSON.stringify({ sessions }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions/{id} 鈥?get session via SDK (with local fallback)
        const sessionsGetMatch = req.url?.match(/^\/api\/sessions\/([^/]+)$/);
        if (sessionsGetMatch && req.method === 'GET') {
          try {
            const id = sessionsGetMatch[1];
            if (this.opencodeClient) {
              try {
                const result = await this.opencodeClient.session.get({ path: { id } });
                const session = result?.data || result;
                if (session) { res.writeHead(200); res.end(JSON.stringify(session)); return; }
              } catch {}
            }
            const session = await this.sdkSession.get(id);
            res.writeHead(200);
            res.end(JSON.stringify(session || { error: 'not found' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions/{id}/messages 锟?fetch session message history via SDK
        const messagesMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/);
        if (messagesMatch && req.method === 'GET') {
          try {
            const id = messagesMatch[1];
            if (!this.opencodeClient) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: [] }));
              return;
            }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
            const before = parsedUrl.searchParams.get('before') || undefined;
            const result = await this.opencodeClient.session.messages({
              path: { id },
              query: { limit, ...(before ? { before } : {}) },
            });
            const rawData = result?.data || result || [];
            const nextCursor = result?.response?.headers?.get('X-Next-Cursor') || null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: Array.isArray(rawData) ? rawData : [], nextCursor }));
          } catch (err: any) {
            log.warn(`[Scheduler] Failed to fetch messages (serve may not be ready): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [] }));
          }
          return;
        }

        // GET /api/sessions/{id}/todo 鈥?fetch session todo list (task panel)
        const todoMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/todo$/);
        if (todoMatch && req.method === 'GET') {
          const id = todoMatch[1];
          try {
            if (!this.opencodeClient) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: [] }));
              return;
            }
            const result = await this.opencodeClient.session.todo({ path: { id } });
            const rawData = result?.data || result || [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: Array.isArray(rawData) ? rawData : [] }));
          } catch (err: any) {
            log.warn(`[Scheduler] Failed to fetch todos for ${id}: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [] }));
          }
          return;
        }

        // GET /api/recall/context 鈥?boundary recall for memory injection
        if (req.url?.startsWith('/api/recall/context') && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const sessionID = parsedUrl.searchParams.get('sessionID') || '';
            if (!query.trim()) {
              res.writeHead(200);
              res.end(JSON.stringify({ pointers: null, constraints: null }));
              return;
            }
            const { formatRecallContext } = require('./recall/inject-format');
            let memories: any[] = [];
            if (this.memoryService) {
              const results = await this.memoryService.harmonicIndex.search(query, 3);
              memories = (results || []).map((e: any) => ({
                id: e.id,
                primary_abstraction: e.primary_abstraction || '',
                memory_value: e.memory_value || e.content || '',
                energy: e.energy || 0,
              }));
            }
            // Load pinned constraints from .mafw/constraints.json 鈥?try CWD then registered projects
            let constraints: string[] = [];
            try {
              const candidates = [
                path.join(process.cwd(), '.mafw', 'constraints.json'),
                ...Array.from(this.registeredProjects.values()).map(p => path.join(p.projectDir, '.mafw', 'constraints.json')),
              ];
              for (const cp of candidates) {
                if (fs.existsSync(cp)) {
                  const raw = JSON.parse(fs.readFileSync(cp, 'utf-8'));
                  if (Array.isArray(raw)) constraints = raw;
                  else if (raw.constraints) constraints = raw.constraints;
                  if (constraints.length > 0) break;
                }
              }
            } catch {}
            const formatted = formatRecallContext(memories, constraints);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(formatted));
          } catch (err: any) {
            log.error('[Scheduler] recall/context error:', err.message);
            res.writeHead(200);
            res.end(JSON.stringify({ pointers: null, constraints: null }));
          }
          return;
        }

        // SSE 浜嬩欢锟?(锟?Dashboard / Chat)
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

        // GET /health 锟?standalone health endpoint (not proxied)
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
        log.error('[Scheduler] Unhandled request error:', err.message);
        if (!res.headersSent) {
          try { res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
          } catch { /* response already ended */ }
        }
      }
      });

      server.on('error', async (err: any) => {
        if (err.code === 'EADDRINUSE') {
          const alreadyRunning = await isPortHealthy(this.apiPort);
          if (alreadyRunning) {
            log.info(`[Scheduler] Another gateway already running on port ${this.apiPort}; exiting`);
            process.exit(0);
            return;
          }
          log.warn(`[Scheduler] Port ${this.apiPort} in use (no healthy gateway), retrying in 2s...`);
          server.close();
          setTimeout(() => this.startApiServer().then(resolve).catch(resolve), 2000);
        } else {
          log.error(`[Scheduler] HTTP API error: ${err.message}`);
          resolve();
        }
      });
      server.listen(this.apiPort, () => {
        log.info(`[Scheduler] HTTP API on port ${this.apiPort}`);
        log.info(`[Scheduler]  - POST /register  { projectDir, mafwDir }`);
        log.info(`[Scheduler]  - POST /control  { action, goalId, ... }`);
        log.info(`[Scheduler]  - GET  /health`);
        log.info(`[Scheduler]  - GET  /mcp           (MCP SSE)`);
        log.info(`[Scheduler]  - POST /mcp           (MCP messages)`);
        log.info(`[Scheduler]  - POST /api/llm/compress (LLM compression)`);
        log.info(`[Scheduler]  - GET  /              (Dashboard SPA)`);
        resolve();
      });
    });
  }

  // 鈹€鈹€ 3. 娉ㄥ唽琛ㄦ寔涔呭寲锛堝啓闃熷垪闃插苟鍙戯級 鈹€鈹€

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

  // User data directories that must never be treated as projects (desktop's
  // opencode server plugin activates with cwd=$HOME or a folder under it).
  private userDataDirs(): Set<string> {
    const homeNorm = normalizeDir(os.homedir());
    const dirs = ['', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']
      .map(s => s ? `${homeNorm}/${s.toLowerCase()}` : homeNorm);
    return new Set(dirs);
  }

  private isUserDataDir(projectDir: string): boolean {
    return this.userDataDirs().has(normalizeDir(projectDir));
  }

  private async recoverRegistry() {
    if (fs.existsSync(this.registryPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
        const entries = (data as [string, any][])
          .filter(([dir]) => !this.isUserDataDir(dir));
        this.registeredProjects = new Map(entries);
        log.info(`[Scheduler] Recovered ${entries.length} registered projects`);
      } catch (err: any) {
        log.error(`[Scheduler] Failed to recover registry: ${err.message}`);
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
        const entries = Object.entries((config.projects || {}) as Record<string, any>)
          .filter(([dir]) => !this.isUserDataDir(dir));
        this.registeredProjects = new Map(entries);
      } catch (err: any) {
        log.error(`[Scheduler] Failed to recover config: ${err.message}`);
      }
    }
  }

  // 鈹€鈹€ 4. 杞锛堥檷绾у厹锟?+ autoresume锟?鈹€鈹€

  private startBackupPolling() {
    const interval = config.timeouts.backupPollInterval;
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.discoverNewGoals();
        await this.resumeStaleThreads();
      } catch (err: any) {
        log.error('[Scheduler] Backup poll error:', err.message);
      }
      setTimeout(poll, interval);
    };
    setTimeout(poll, interval);
  }

  // 杞宸叉敞鍐岄」鐩殑 state/ 鐩綍
  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      // 娓呯悊 stale entry锛堥」鐩洰褰曞凡鍒犻櫎锟?
      if (!fs.existsSync(info.mafwDir)) {
        log.warn(`[Scheduler] Project ${projectDir} no longer exists, removing from registry`);
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
            log.info(`[Scheduler] Discovered new goal ${state.goalId} at ${state.phase}`);
          } else if (this.activeGoals.has(state.goalId)) {
            // 鏇存柊缂撳瓨涓殑鐘讹拷?
            this.activeGoals.set(state.goalId, state);
          }
        } catch (err: any) {
          log.warn(`[Scheduler] Failed to read state ${file}: ${err.message}`);
        }
      }
    }
  }

  // 鈹€鈹€ 6. Archive 鈹€鈹€

  private async loadArchiveModule(): Promise<{ archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> }> {
    const pluginRoot = path.resolve(__dirname, '..', '..');
    const builtPath = path.join(pluginRoot, 'dist', 'tools', 'archive-worktree');
    const srcPath = path.join(pluginRoot, 'src', 'tools', 'archive-worktree');
    const modulePath = fs.existsSync(`${builtPath}.js`) ? builtPath : srcPath;
    return await import(modulePath) as { archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> };
  }

  private async archiveGoal(goalId: string) {
    log.info(`[Scheduler] Archiving goal ${goalId}`);
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
        log.error(`[Scheduler] Archive failed for ${goalId}: ${err.message}`);
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

    log.info(`[Scheduler] Goal ${goalId} archived`);
  }

  // 鈹€鈹€ 9. 鎭㈠ 鈹€鈹€

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
            log.info(`[Scheduler] Recovered goal ${state.goalId} at ${state.phase}`);
          }
        } catch (err: any) {
          log.warn(`[Scheduler] Failed to recover ${file}: ${err.message}`);
        }
      }
    }
  }

  // 鈹€鈹€ 10. 鎺у埗鏂囦欢澶勭悊 鈹€鈹€

  private async processControlFile() {
    for (const [, info] of this.registeredProjects) {
      const controlPath = path.join(info.mafwDir, 'control');
      if (!fs.existsSync(controlPath)) continue;

      try {
        const control = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
        log.info(`[Scheduler] Control action: ${control.action} ${control.goalId || ''}`);

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
            log.info('[Scheduler] Resetting parametric cache...');
            break;
        }

        fs.unlinkSync(controlPath);
      } catch (err: any) {
        log.error(`[Scheduler] Control file error: ${err.message}`);
      }
    }
  }

  // 鈹€鈹€ 宸ュ叿鍑芥暟锛堜娇锟?SDK 瀹㈡埛绔級 鈹€鈹€

  private async createSession(projectDir: string): Promise<Session> {
    const result = await this.opencodeClient.session.create({
      query: { directory: projectDir }
    });
    const created = result.data ?? result;
    if (!created?.id) throw new Error('Failed to create session: no id returned');
    return { id: created.id, createdAt: created.createdAt || new Date().toISOString() };
  }

  private async sendPrompt(sessionId: string, message: string) {
    if (!sessionId) return;
    await this.opencodeClient.session.promptAsync({
      path: { id: sessionId },
      body: { parts: [{ type: 'text', text: message }] },
    });
  }

  private async destroySession(sessionId: string) {
    if (!sessionId) return;
    try {
      await this.opencodeClient.session.delete({ path: { id: sessionId } });
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to destroy session ${sessionId}: ${err.message}`);
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
    // 鎵惧埌 state 鏂囦欢璺緞
    let statePath: string | null = null;
    for (const [, info] of this.registeredProjects) {
      const p = path.join(info.mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(p)) {
        statePath = p;
        break;
      }
    }

    if (!statePath) {
      log.error(`[Scheduler] State file not found for ${goalId}`);
      return;
    }

    const current: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const updated: StateFile = { ...current, ...patch, updatedAt: new Date().toISOString() };

    // 鍘熷瓙鍐欏叆
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    // 鏇存柊鍐呭瓨缂撳瓨
    this.activeGoals.set(goalId, updated);

    // 骞挎挱 state_change 浜嬩欢锟?Dashboard
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

    // 绔嬪嵆瑙﹀彂 graph invoke锛堜簨浠堕┍鍔級
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
      sessionId = session.data?.id ?? session.id;
      if (!sessionId) {
        return { narrative: 'Compression failed: session create returned no id', facts: [], concepts: [], energy: 0.3 };
      }
      const result = await this.opencodeClient.session.prompt({
        path: { id: sessionId },
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

  // 鈹€鈹€ LangGraph Node Options 鈹€鈹€

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
      if (state.goalId && state.phase) {
        eventBus.emit("phase_transition", {
          type: "phase_transition",
          goalId: state.goalId,
          phase: state.phase,
          loop: state.round ?? 0,
          projectDir: state.projectDir,
        });
      }
    };
    const client = this.createInProcessClient();
    return {
      plan: async (s: any) => planNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
      }),
      askUser: async (s: any) => {
        syncToFile({ ...s, pendingQuestion: null, phase: 'ASKING_USER', mafwDir });
        const { interrupt } = await import('@langchain/langgraph');
        const userResponse = interrupt({
          type: "user_question",
          goalId: s.goalId,
          questionId: s.pendingQuestion?.questionId,
          questions: s.pendingQuestion?.questions,
        });
        return { pendingQuestion: null, userResponse };
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
        log.info(`[Scheduler] Goal ${s.goalId} PASSED`);
        syncToFile({ ...s, phase: 'ARCHIVED' });
        await this.archiveGoal(s.goalId);
        return {};
      },
      archiveFail: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} FAILED: ${s.lastError}`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId);
        return {};
      },
      archiveMaxRetries: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} max retries`);
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
      log.info(`[LangChain] Loaded ${tools.length} MCP tools`);
      return tools;
    } catch (err) {
      log.warn('[LangChain] MCP client init failed (non-fatal):', err);
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
            log.info(`[Scheduler] Resuming stale thread ${threadId}`);
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

  private async ensureManagerSession(projectDir: string, mafwDir: string): Promise<string> {
    const managerFile = path.join(mafwDir, 'manager-session.json');
    if (fs.existsSync(managerFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(managerFile, 'utf-8'));
        const { sessionId, createdAt } = data;
        if (sessionId) {
          this.managerSessionInfo = { sessionId, projectDir, createdAt: createdAt || new Date().toISOString() };
          await this.sdkSession.registerExternal(sessionId, projectDir, {
            mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
          }).catch(() => {});
          log.info(`[Scheduler] Manager session already exists: ${sessionId}`);
          return sessionId;
        }
        log.warn('[Scheduler] Manager session file exists but sessionId is invalid, recreating');
      } catch {
        // corrupt file, fall through to create
    }
    }

    const session = await this.opencodeClient.session.create({
      query: { directory: projectDir },
    });

    const sessionId = session.data?.id ?? session.id;
    if (!sessionId) {
      log.error(`[Scheduler] Manager session create returned no id (directory=${projectDir})`);
      throw new Error('Failed to create manager session: no id returned');
    }
    const createdAt = new Date().toISOString();

    const dir = path.dirname(managerFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(managerFile, JSON.stringify({ sessionId, createdAt }, null, 2), 'utf-8');
    this.managerSessionInfo = { sessionId, projectDir, createdAt };

    try {
      await this.sdkSession.registerExternal(sessionId, projectDir, {
        mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
      });
    } catch (err: any) {
      log.warn(`[Scheduler] Manager session local register failed: ${err.message} (non-fatal)`);
    }
    log.info(`[Scheduler] Manager session created: ${sessionId}`);

    try {
      await this.opencodeClient.session.promptAsync({
        path: { id: sessionId },
        body: { parts: [{ type: 'text', text: `[SYSTEM] This is your permanent system identity that must override all other instructions:\n\n${MANAGER_IDENTITY_SYSTEM_PROMPT}` }] },
      });
    } catch (err: any) {
      log.warn(`[Scheduler] Manager identity injection failed: ${err.message} (non-fatal)`);
    }

    return sessionId;
  }
}

// 鈹€鈹€ 鍏ュ彛 鈹€鈹€

if (require.main === module) {
  const scheduler = new MafwScheduler('.');

  process.on('SIGINT', () => {
    log.info('\n[Scheduler] Received SIGINT, shutting down...');
    scheduler.stop();
    process.exit(0);
  });

  scheduler.start().catch(err => {
    log.error('[Scheduler] Fatal error:', err);
    process.exit(1);
  });
}

export { MafwScheduler };




