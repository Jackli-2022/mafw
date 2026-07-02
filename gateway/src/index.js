"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MafwScheduler = void 0;
exports.phaseToCreateAction = phaseToCreateAction;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const http = __importStar(require("http"));
const child_process_1 = require("child_process");
const server_1 = require("./dashboard/server");
function phaseToCreateAction(phase) {
    const normalized = (phase || '').replace(/_COMPLETE$/, '');
    switch (normalized) {
        case 'PLANNING':
            return 'CREATE_PLAN_SESSION';
        case 'EXECUTING':
            return 'CREATE_EXECUTE_SESSION';
        case 'REVIEWING':
            return 'CREATE_REVIEW_SESSION';
        default:
            return `CREATE_${(phase || 'UNKNOWN').toUpperCase()}_SESSION`;
    }
}
function resolveOpencode() {
    // 按优先级查找 opencode.exe
    const npmPrefix = process.env.MAFW_OPENCODE_PATH
        ? path.dirname(process.env.MAFW_OPENCODE_PATH)
        : (0, child_process_1.execSync)('npm config get prefix', { encoding: 'utf-8' }).trim();
    const candidates = [
        path.join(npmPrefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
        path.join(npmPrefix, 'node_modules', '@opencode-ai', 'cli', 'bin', 'lildax'),
        path.join(npmPrefix, 'opencode.cmd'),
        path.join(npmPrefix, 'opencode'),
        process.env.MAFW_OPENCODE_PATH || '',
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c))
            return c;
    }
    throw new Error('opencode CLI not found. Install: npm install -g @opencode-ai/cli');
}
class MafwScheduler {
    serveProcess;
    serveUrl = 'http://127.0.0.1:4096';
    apiPort = 3000;
    pollInterval = 5000;
    projectDir;
    activeGoals = new Map();
    registeredProjects = new Map();
    sessionMonitors = new Map();
    registryPath;
    registryWriteQueue = Promise.resolve();
    configPath;
    configWriteQueue = Promise.resolve();
    running = true;
    dashboard;
    opencodeClient = null;
    sseClients = new Set();
    constructor(projectDir = '.') {
        this.projectDir = projectDir;
        this.configPath = path.join(os.homedir(), '.config', 'mafw', 'config.json');
        this.registryPath = path.join(projectDir, 'scheduler', 'registered-projects.json');
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
        this.dashboard = new server_1.DashboardServer(3001, this.projectDir);
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
    async subscribeToEvents() {
        try {
            const stream = await this.opencodeClient.event.subscribe({});
            if (stream && typeof stream.on === 'function') {
                stream.on('data', (event) => {
                    this.broadcast({ type: 'opencode_event', data: event });
                });
                console.log('[Scheduler] Subscribed to OpenCode events');
            }
        }
        catch (err) {
            console.warn(`[Scheduler] SDK event subscribe failed (non-fatal): ${err.message}`);
        }
    }
    broadcast(event) {
        const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
        for (const client of this.sseClients) {
            try {
                client.write(data);
            }
            catch {
                this.sseClients.delete(client);
            }
        }
    }
    stop() {
        this.running = false;
        if (this.serveProcess) {
            this.serveProcess.kill('SIGTERM');
            this.serveProcess = undefined;
        }
        for (const timer of this.sessionMonitors.values()) {
            clearTimeout(timer);
        }
        if (this.dashboard) {
            this.dashboard.stop();
        }
        console.log('[Scheduler] Stopping...');
    }
    // ── 1. Serve 管理 ──
    async startServe() {
        const opencodeExe = resolveOpencode();
        console.log(`[Scheduler] Starting OpenCode Serve: ${opencodeExe}`);
        this.serveProcess = (0, child_process_1.spawn)(opencodeExe, [
            'serve', '--port', '4096', '--hostname', '127.0.0.1'
        ], {
            cwd: this.projectDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PATH: process.env.PATH }
        });
        this.serveProcess.stdout?.on('data', (data) => {
            const line = data.toString().trim();
            if (line)
                console.log(`[Serve] ${line}`);
        });
        this.serveProcess.stderr?.on('data', (data) => {
            const line = data.toString().trim();
            if (line)
                console.error(`[Serve] ${line}`);
        });
        this.serveProcess.on('exit', (code) => {
            console.error(`[Scheduler] Serve exited with code ${code}, restarting in 5s...`);
            this.serveProcess = undefined;
            if (this.running) {
                setTimeout(() => this.startServe(), 5000);
            }
        });
        await this.waitForServeReady();
    }
    async isServeHealthy() {
        try {
            const res = await fetch(`${this.serveUrl}/health`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async waitForServeReady() {
        for (let retries = 0; retries < 60; retries++) {
            await this.sleep(1000);
            if (await this.isServeHealthy()) {
                console.log('[Scheduler] Serve is ready');
                return;
            }
        }
        throw new Error('Failed to start OpenCode Serve after 60 seconds');
    }
    async initClient() {
        const { createOpencodeClient } = await Promise.resolve().then(() => __importStar(require('@opencode-ai/sdk')));
        this.opencodeClient = createOpencodeClient({ baseUrl: this.serveUrl });
        console.log('[Scheduler] SDK client initialized');
    }
    // ── 2. HTTP API ──
    async startApiServer() {
        return new Promise((resolve) => {
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
                        }
                        catch (err) {
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
                                    if (control.goalId)
                                        await this.patchState(control.goalId, { nextAction: 'PAUSED' });
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
                        }
                        catch (err) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Invalid JSON' }));
                        }
                    });
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
                if (req.url === '/api/events' && req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', async () => {
                        try {
                            const event = JSON.parse(body);
                            console.log(`[Events] Received: ${event.type} for ${event.goalId || ''}`);
                            this.broadcast(event);
                            // 立即处理该 goal 的状态机
                            if (event.type === 'state_change' && event.goalId) {
                                await this.advanceSingleGoal(event.goalId);
                            }
                            res.writeHead(200);
                            res.end(JSON.stringify({ status: 'ok' }));
                        }
                        catch (err) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Invalid event' }));
                        }
                    });
                    return;
                }
                // SSE 事件流 (给 Dashboard)
                if (req.url === '/api/events' && req.method === 'GET') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
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
    async persistRegistry() {
        this.registryWriteQueue = this.registryWriteQueue.then(async () => {
            const dir = path.dirname(this.registryPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.registryPath, JSON.stringify(Array.from(this.registeredProjects.entries()), null, 2));
        });
        await this.registryWriteQueue;
    }
    async recoverRegistry() {
        if (fs.existsSync(this.registryPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
                this.registeredProjects = new Map(data);
                console.log(`[Scheduler] Recovered ${data.length} registered projects`);
            }
            catch (err) {
                console.error(`[Scheduler] Failed to recover registry: ${err.message}`);
            }
        }
    }
    async persistConfig() {
        this.configWriteQueue = this.configWriteQueue.then(async () => {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            let config = {};
            if (fs.existsSync(this.configPath)) {
                config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
            }
            config.projects = Object.fromEntries(this.registeredProjects);
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        });
        await this.configWriteQueue;
    }
    async recoverConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
                this.registeredProjects = new Map(Object.entries(config.projects || {}));
            }
            catch (err) {
                console.error(`[Scheduler] Failed to recover config: ${err.message}`);
            }
        }
    }
    // ── 4. 轮询（降级兜底：仅处理 SSE 丢失的 goal） ──
    startBackupPolling() {
        const poll = async () => {
            if (!this.running)
                return;
            try {
                await this.discoverNewGoals();
                // 仅处理不在活跃缓存中的 goal
                for (const [goalId, state] of this.activeGoals) {
                    if (['COMPLETED', 'FAILED'].includes(state.nextAction)) {
                        this.activeGoals.delete(goalId);
                    }
                }
            }
            catch (err) {
                console.error('[Scheduler] Backup poll error:', err.message);
            }
            setTimeout(poll, 30000);
        };
        setTimeout(poll, 30000);
    }
    async advanceSingleGoal(goalId) {
        const state = this.activeGoals.get(goalId);
        if (!state) {
            // 可能还没被发现，先 discover 一下
            await this.discoverNewGoals();
        }
        await this.advanceStateMachines();
    }
    // 轮询已注册项目的 state/ 目录
    async discoverNewGoals() {
        for (const [projectDir, info] of this.registeredProjects) {
            // 清理 stale entry（项目目录已删除）
            if (!fs.existsSync(info.mafwDir)) {
                console.warn(`[Scheduler] Project ${projectDir} no longer exists, removing from registry`);
                this.registeredProjects.delete(projectDir);
                await this.persistRegistry();
                continue;
            }
            const stateDir = path.join(info.mafwDir, 'state');
            if (!fs.existsSync(stateDir))
                continue;
            const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
            for (const file of stateFiles) {
                try {
                    const statePath = path.join(stateDir, file);
                    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                    if (!this.activeGoals.has(state.goalId) &&
                        state.nextAction !== 'COMPLETED' &&
                        state.nextAction !== 'FAILED') {
                        this.activeGoals.set(state.goalId, state);
                        console.log(`[Scheduler] Discovered new goal ${state.goalId} at ${state.phase}`);
                    }
                    else if (this.activeGoals.has(state.goalId)) {
                        // 更新缓存中的状态
                        this.activeGoals.set(state.goalId, state);
                    }
                }
                catch (err) {
                    console.warn(`[Scheduler] Failed to read state ${file}: ${err.message}`);
                }
            }
        }
    }
    // 推进状态机
    async advanceStateMachines() {
        for (const [goalId, state] of this.activeGoals) {
            const nextAction = state.nextAction;
            let transitioned = false;
            switch (nextAction) {
                case 'CREATE_PLAN_SESSION':
                    await this.createPhaseSession(goalId, 'plan', '/skill mafw-plan');
                    transitioned = true;
                    break;
                case 'CREATE_EXECUTE_SESSION':
                    await this.createPhaseSession(goalId, 'execute', '/skill mafw-execute');
                    transitioned = true;
                    break;
                case 'CREATE_REVIEW_SESSION':
                    await this.createPhaseSession(goalId, 'review', '/skill mafw-review');
                    transitioned = true;
                    break;
                case 'ARCHIVE':
                    await this.archiveGoal(goalId);
                    this.activeGoals.delete(goalId);
                    transitioned = true;
                    break;
                case 'COMPLETED':
                case 'FAILED':
                    this.activeGoals.delete(goalId);
                    transitioned = true;
                    break;
                case 'WAIT_PHASE_COMPLETE':
                    // 等待 Skill Entry 更新 state 文件
                    break;
                default:
                    console.warn(`[Scheduler] Unknown nextAction: ${nextAction} for ${goalId}`);
            }
            // 广播 loop_transition 事件到 Dashboard
            if (transitioned) {
                this.broadcast({
                    type: 'loop_transition',
                    timestamp: new Date().toISOString(),
                    goalId,
                    loopNum: state.loop,
                    waveNum: state.currentWave,
                    data: { from: state.nextAction, to: nextAction }
                });
            }
        }
    }
    // ── 5. Phase Session 创建 ──
    async createPhaseSession(goalId, phase, prompt) {
        // 读取请求配置获取 projectDir
        const state = this.activeGoals.get(goalId);
        if (!state)
            return;
        // 从注册表查找项目
        let projectDir = null;
        for (const [pDir, info] of this.registeredProjects) {
            const stateDir = path.join(info.mafwDir, 'state');
            if (fs.existsSync(path.join(stateDir, `${goalId}.json`))) {
                projectDir = pDir;
                break;
            }
        }
        if (!projectDir) {
            console.error(`[Scheduler] Cannot find project for goal ${goalId}`);
            return;
        }
        // 如果该 phase 已有活跃 session，先销毁
        const existing = state.sessions?.[phase];
        if (existing?.active) {
            await this.destroySession(existing.id);
        }
        console.log(`[Scheduler] Creating ${phase} session for ${goalId}`);
        const session = await this.createSession(projectDir);
        // 更新 state 文件（追加 session 记录，设置 WAIT_PHASE_COMPLETE）
        await this.patchState(goalId, {
            sessions: {
                ...state.sessions,
                [phase]: { id: session.id, createdAt: new Date().toISOString(), active: true }
            },
            nextAction: 'WAIT_PHASE_COMPLETE'
        });
        // 发送 prompt
        await this.sendPrompt(session.id, `${prompt} ${goalId}`);
        // 启动心跳监控
        this.startSessionMonitor(goalId, phase, session.id);
        console.log(`[Scheduler] ${phase} session ${session.id} created for ${goalId}`);
    }
    // ── 6. Archive ──
    async loadArchiveModule() {
        const pluginRoot = path.resolve(__dirname, '..', '..');
        const builtPath = path.join(pluginRoot, 'dist', 'tools', 'archive-worktree');
        const srcPath = path.join(pluginRoot, 'src', 'tools', 'archive-worktree');
        const modulePath = fs.existsSync(`${builtPath}.js`) ? builtPath : srcPath;
        return await Promise.resolve(`${modulePath}`).then(s => __importStar(require(s)));
    }
    async archiveGoal(goalId) {
        console.log(`[Scheduler] Archiving goal ${goalId}`);
        await this.destroyAllSessions(goalId);
        let projectDir = null;
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
            }
            catch (err) {
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
    // ── 8. 心跳监控 ──
    startSessionMonitor(goalId, phase, sessionId) {
        const key = `${goalId}:${phase}`;
        // 清除旧监控
        if (this.sessionMonitors.has(key)) {
            clearTimeout(this.sessionMonitors.get(key));
        }
        const timeout = setTimeout(async () => {
            console.error(`[Scheduler] ${goalId} ${phase} session timeout, recreating...`);
            await this.destroySession(sessionId);
            await this.patchState(goalId, {
                nextAction: `CREATE_${phase.toUpperCase()}_SESSION`,
                error: 'heartbeat_timeout'
            });
        }, 5 * 60 * 1000); // 5 分钟
        this.sessionMonitors.set(key, timeout);
    }
    async checkHeartbeats() {
        for (const [goalId, state] of this.activeGoals) {
            const lastUpdate = new Date(state.updatedAt).getTime();
            if (Date.now() - lastUpdate > 5 * 60 * 1000) {
                // 整个 Goal 卡死，重置到当前 phase 的 CREATE 状态
                const currentPhase = state.phase;
                if (currentPhase && currentPhase !== 'COMPLETED' && currentPhase !== 'ARCHIVED') {
                    console.error(`[Scheduler] Goal ${goalId} heartbeat timeout, resetting phase ${currentPhase}`);
                    await this.patchState(goalId, {
                        nextAction: phaseToCreateAction(currentPhase),
                        error: 'goal_heartbeat_timeout'
                    });
                }
            }
        }
    }
    // ── 9. 恢复 ──
    async recoverState() {
        for (const [projectDir, info] of this.registeredProjects) {
            const stateDir = path.join(info.mafwDir, 'state');
            if (!fs.existsSync(stateDir))
                continue;
            const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
            for (const file of stateFiles) {
                try {
                    const statePath = path.join(stateDir, file);
                    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                    if (state.nextAction !== 'COMPLETED' && state.nextAction !== 'FAILED') {
                        this.activeGoals.set(state.goalId, state);
                        console.log(`[Scheduler] Recovered goal ${state.goalId} at ${state.phase}`);
                    }
                }
                catch (err) {
                    console.warn(`[Scheduler] Failed to recover ${file}: ${err.message}`);
                }
            }
        }
    }
    // ── 10. 控制文件处理 ──
    async processControlFile() {
        for (const [, info] of this.registeredProjects) {
            const controlPath = path.join(info.mafwDir, 'control');
            if (!fs.existsSync(controlPath))
                continue;
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
            }
            catch (err) {
                console.error(`[Scheduler] Control file error: ${err.message}`);
            }
        }
    }
    // ── 工具函数（使用 SDK 客户端） ──
    async createSession(projectDir) {
        const result = await this.opencodeClient.session.create({
            directory: projectDir,
            metadata: { mafw: true }
        });
        return { id: result.id, createdAt: result.createdAt || new Date().toISOString() };
    }
    async sendPrompt(sessionId, message) {
        await this.opencodeClient.session.promptAsync({
            sessionID: sessionId,
            message
        });
    }
    async destroySession(sessionId) {
        try {
            await this.opencodeClient.session.delete({ sessionID: sessionId });
        }
        catch (err) {
            console.warn(`[Scheduler] Failed to destroy session ${sessionId}: ${err.message}`);
        }
    }
    async destroyAllSessions(goalId) {
        const state = this.activeGoals.get(goalId);
        if (!state)
            return;
        for (const [phase, session] of Object.entries(state.sessions)) {
            if (session.active) {
                await this.destroySession(session.id);
                // 清除监控
                const key = `${goalId}:${phase}`;
                if (this.sessionMonitors.has(key)) {
                    clearTimeout(this.sessionMonitors.get(key));
                    this.sessionMonitors.delete(key);
                }
            }
        }
    }
    async patchState(goalId, patch) {
        // 找到 state 文件路径
        let statePath = null;
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
        const current = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
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
    async loadRequest(goalId) {
        for (const [projectDir, info] of this.registeredProjects) {
            const reqPath = path.join(info.mafwDir, 'requests', `${goalId}.json`);
            if (fs.existsSync(reqPath)) {
                return JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
            }
        }
        return null;
    }
    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
exports.MafwScheduler = MafwScheduler;
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
//# sourceMappingURL=index.js.map