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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const child_process_1 = require("child_process");
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
    running = true;
    constructor(projectDir = '.') {
        this.projectDir = projectDir;
        this.registryPath = path.join(projectDir, 'scheduler', 'registered-projects.json');
    }
    async start() {
        console.log('[Scheduler] MAFW Scheduler v3.5 starting...');
        // 1. 启动 Serve
        await this.startServe();
        // 2. 启动 HTTP API
        await this.startApiServer();
        // 3. 恢复注册表
        await this.recoverRegistry();
        // 4. 恢复活跃 Goal
        await this.recoverState();
        // 5. 开始轮询
        console.log('[Scheduler] Starting polling loop...');
        await this.startPolling();
    }
    stop() {
        this.running = false;
        if (this.serveProcess) {
            this.serveProcess.kill('SIGTERM');
        }
        // 清理所有监控定时器
        for (const timer of this.sessionMonitors.values()) {
            clearTimeout(timer);
        }
        console.log('[Scheduler] Stopping...');
    }
    // ── 1. Serve 管理 ──
    async startServe() {
        if (await this.isServeHealthy()) {
            console.log('[Scheduler] Serve already running, skip start');
            return;
        }
        console.log('[Scheduler] Starting OpenCode Serve...');
        this.serveProcess = (0, child_process_1.spawn)('opencode', [
            'serve', '--port', '4096', '--hostname', '127.0.0.1'
        ], {
            cwd: this.projectDir,
            stdio: ['ignore', 'pipe', 'pipe']
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
        let retries = 0;
        while (retries < 60) {
            await this.sleep(1000);
            if (await this.isServeHealthy()) {
                console.log('[Scheduler] Serve is ready');
                return;
            }
            retries++;
        }
        throw new Error('Failed to start OpenCode Serve after 60 seconds');
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
    // ── 4. 轮询 ──
    async startPolling() {
        while (this.running) {
            try {
                await this.processControlFile();
                await this.discoverNewGoals();
                await this.advanceStateMachines();
                await this.checkHeartbeats();
            }
            catch (err) {
                console.error('[Scheduler] Poll error:', err.message);
            }
            await this.sleep(this.pollInterval);
        }
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
            switch (nextAction) {
                case 'CREATE_PLAN_SESSION':
                    await this.createPhaseSession(goalId, 'plan', '/skill mafw-plan');
                    break;
                case 'CREATE_EXECUTE_SESSION':
                    await this.createPhaseSession(goalId, 'execute', '/skill mafw-execute');
                    break;
                case 'CREATE_REVIEW_SESSION':
                    await this.createPhaseSession(goalId, 'review', '/skill mafw-review');
                    break;
                case 'CHECK_VERDICT':
                    await this.handleVerdict(goalId);
                    break;
                case 'ARCHIVE':
                    await this.archiveGoal(goalId);
                    this.activeGoals.delete(goalId);
                    break;
                case 'COMPLETED':
                case 'FAILED':
                    this.activeGoals.delete(goalId);
                    break;
                case 'WAIT_PHASE_COMPLETE':
                    // 等待 Skill Entry 更新 state 文件
                    break;
                default:
                    console.warn(`[Scheduler] Unknown nextAction: ${nextAction} for ${goalId}`);
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
    // ── 6. Verdict 处理（极简，只读文件） ──
    async handleVerdict(goalId) {
        const state = this.activeGoals.get(goalId);
        if (!state)
            return;
        // 读取请求配置
        const req = await this.loadRequest(goalId);
        if (!req) {
            console.error(`[Scheduler] No request file for ${goalId}`);
            await this.patchState(goalId, { nextAction: 'FAILED' });
            return;
        }
        const reviewPath = state.artifacts?.review;
        if (!reviewPath) {
            console.error(`[Scheduler] No review artifact for ${goalId}`);
            await this.patchState(goalId, { nextAction: 'FAILED' });
            return;
        }
        // 读取 review 文件（只读，不解析业务逻辑）
        const review = await this.loadReviewFile(reviewPath, req.projectDir);
        if (!review) {
            console.error(`[Scheduler] Cannot read review file for ${goalId}`);
            await this.patchState(goalId, { nextAction: 'FAILED' });
            return;
        }
        // 检查 verdict
        if (review.verdict === 'PASS' && this.checkMetrics(req.metrics, review.metrics)) {
            await this.patchState(goalId, { nextAction: 'ARCHIVE' });
            console.log(`[Scheduler] Goal ${goalId} verdict: PASS → ARCHIVE`);
        }
        else {
            const currentLoop = state.loop;
            if (currentLoop >= req.maxLoops) {
                await this.patchState(goalId, { nextAction: 'ARCHIVE' });
                console.log(`[Scheduler] Goal ${goalId} maxLoops reached → ARCHIVE`);
            }
            else {
                // 进入下一轮
                await this.patchState(goalId, {
                    loop: currentLoop + 1,
                    phase: 'PLANNING',
                    nextAction: 'CREATE_PLAN_SESSION',
                    sessions: {},
                    artifacts: {}
                });
                console.log(`[Scheduler] Goal ${goalId} verdict: FAIL → Loop ${currentLoop + 1}`);
            }
        }
    }
    // ── 7. Archive ──
    async archiveGoal(goalId) {
        console.log(`[Scheduler] Archiving goal ${goalId}`);
        // 销毁所有 session
        await this.destroyAllSessions(goalId);
        // 更新 state
        await this.patchState(goalId, {
            nextAction: 'COMPLETED',
            phase: 'ARCHIVED'
        });
        // 更新 STATUS.md
        // 实际应调用 StatusManager
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
                        nextAction: `CREATE_${currentPhase.toUpperCase()}_SESSION`,
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
    // ── 工具函数 ──
    async createSession(projectDir) {
        const res = await fetch(`${this.serveUrl}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: { mafw: true }, directory: projectDir })
        });
        return res.json();
    }
    async sendPrompt(sessionId, message) {
        await fetch(`${this.serveUrl}/session/${sessionId}/prompt_async`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
    }
    async destroySession(sessionId) {
        try {
            await fetch(`${this.serveUrl}/session/${sessionId}`, { method: 'DELETE' });
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
    async loadReviewFile(reviewPath, projectDir) {
        const fullPath = path.join(projectDir, '.opencode/mafw', reviewPath);
        if (!fs.existsSync(fullPath))
            return null;
        const content = fs.readFileSync(fullPath, 'utf-8');
        // 简单解析：查找 verdict
        const pass = content.includes('Verdict: PASS') || content.toLowerCase().includes('pass');
        const fail = content.includes('Verdict: FAIL') || content.toLowerCase().includes('fail');
        const verdict = pass ? 'PASS' : fail ? 'FAIL' : 'UNKNOWN';
        // 解析 metrics
        const metrics = {};
        const metricMatches = content.matchAll(/- (\w+):\s*(\d+\.?\d*)/g);
        for (const match of metricMatches) {
            metrics[match[1]] = parseFloat(match[2]);
        }
        return { verdict, metrics };
    }
    checkMetrics(reqMetrics, reviewMetrics) {
        if (!reviewMetrics)
            return true;
        for (const [key, target] of Object.entries(reqMetrics)) {
            const actual = reviewMetrics[key];
            if (actual === undefined)
                continue;
            if (actual < target.target) {
                return false;
            }
        }
        return true;
    }
    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
// ── 入口 ──
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
