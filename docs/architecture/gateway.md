# MAFW Gateway 架构

> 常驻进程，负责 Phase 调度、Session 管理、Dashboard 服务、SSE 事件推送、LLM 代理、进程生命周期管理。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [CLI 二进制设计](#cli-二进制设计)
- [MafwScheduler 详细设计](#mafwscheduler-详细设计)
- [DashboardServer 详细设计](#dashboardserver-详细设计)
- [DashboardAPI 详细设计](#dashboardapi-详细设计)
- [RecoveryManager 详细设计](#recoverymanager-详细设计)
- [SessionManager 详细设计](#sessionmanager-详细设计)
- [API 端点完整列表](#api-端点完整列表)
- [数据流全景](#数据流全景)
- [配置](#配置)
- [跨平台服务注册](#跨平台服务注册)

---

## 代码位置

```
gateway/
├── bin/
│   └── mafw-gateway.js          # CLI 入口（进程管理）
├── src/
│   ├── index.ts                 # MafwScheduler — 主调度器 (~800 行)
│   │
│   ├── dashboard/
│   │   ├── server.ts            # HTTP + SSE 服务器 (~140 行)
│   │   ├── api.ts               # REST API 处理器 (~1100 行)
│   │   ├── types.ts             # SchedulerState 接口
│   │   └── public/
│   │       ├── index.html       # SPA 入口 (8 视图)
│   │       └── app.js           # SPA 逻辑 (~550 行)
│   │
│   ├── recovery.ts              # RecoveryManager — Checkpoint CRUD (~90 行)
│   ├── session-manager.ts       # Session 生命周期管理 (~60 行)
│   ├── health.ts                # 健康检查端点
│   ├── heartbeat.ts             # Agent 心跳检测
│   ├── poll.ts                  # 状态轮询
│   ├── loop-monitor.ts          # Loop 执行状态追踪
│   └── ledger.ts                # 操作日志记录
│
├── dist/                        # 编译输出
├── package.json
└── tsconfig.json
```

---

## 生命周期

### Gateway 进程生命周期

```
npx mafw-gateway start
    │
    ▼
1. CLI (bin/mafw-gateway.js)
    ├── ensureDirs() → 创建 ~/.config/mafw/{logs, gateway.pid}
    ├── spawn(process.execPath, [gateway/dist/index.js])
    │   ├── foreground: { stdio: 'inherit' }
    │   └── daemon: { stdio: 'ignore', detached: true, windowsHide: true }
    │
    ▼
2. MafwScheduler.start()
    │
    ├── 2a. startServe()
    │       spawn(opencode.exe, ['serve', '--port', '4096'])
    │       opencode server listening on http://127.0.0.1:4096
    │
    ├── 2b. initSDK()
    │       const client = createOpencodeClient({ port: 4096 })
    │
    ├── 2c. DashboardServer.start()
    │       HTTP server @ http://localhost:3001
    │
    ├── 2d. registerProjects()
    │       scan ~/.config/mafw/projects.json → POST /register
    │
    └── 2e. pollLoop()
        setInterval(5000) → check state files → dispatch next actions
```

### Goal 调度生命周期

```
状态文件轮询 (每 5 秒)
    │
    ├── 读取 .opencode/mafw/state/{goalId}.json
    │
    ├── nextAction === 'CREATE_PLAN_SESSION'
    │   → SessionManager.createSession(goalId, 'mafw-plan')
    │
    ├── nextAction === 'CREATE_EXECUTE_SESSION'
    │   → SessionManager.createSession(goalId, 'mafw-execute')
    │
    ├── nextAction === 'CREATE_REVIEW_SESSION'
    │   → SessionManager.createSession(goalId, 'mafw-review')
    │
    ├── nextAction === 'ARCHIVE'
    │   → archiveGoal(goalId)
    │       ├── archiveWorktree(goalId)  → Git tag
    │       └── updateState(phase='ARCHIVED')
    │
    ├── nextAction === 'PAUSED'
    │   → 跳过（用户手动暂停）
    │
    └── nextAction === 'WAIT_PHASE_COMPLETE'
        → 跳过（等待 Agent 完成）
```

### Session 生命周期

```
SessionManager.createSession(goalId, skill)
    │
    ├── 1. POST /api/session → createOpencodeClient().sessions.create()
    │
    ├── 2. 发送 /skill {skill} {goalId}
    │       → opencode 打开子进程 → Agent 开始工作
    │
    ├── 3. 等待 session.destroyed
    │       → 心跳检测 (每 30 秒)
    │       → 超时检测 (5 分钟无心跳 → 标记 FAILED)
    │
    └── 4. 更新 state → 轮询发现 next action
```

---

## CLI 二进制设计

**文件**：`bin/mafw-gateway.js`（~300 行）

### 命令表

| 命令 | 函数 | 描述 |
|---|---|---|
| `start` | `startGateway(false)` | 前台启动 |
| `daemon` | `startGateway(true)` | 后台守护 |
| `stop` | `stopGateway()` | kill PID |
| `status` | `showStatus()` | 检查 PID 存活 |
| `restart` | `stop → setTimeout(1s) → start` | 重启 |
| `dashboard` | `openDashboard()` | 打开浏览器 |
| `logs` | `showLogs()` | tail 50 行 |
| `config` | `showConfig()` | 显示配置 |
| `service-register` | `registerService()` | 系统服务注册 |
| `service-unregister` | `unregisterService()` | 系统服务卸载 |

### 进程管理

```javascript
// PID 文件: ~/.config/mafw/gateway.pid
// 日志文件: ~/.config/mafw/logs/gateway.log

function startGateway(background) {
  // 1. 检查 PID 文件 → 已有则退出
  // 2. spawn(process.execPath, [GATEWAY_SCRIPT], {
  //      stdio: background ? 'ignore' : 'inherit',
  //      detached: background,
  //      windowsHide: true
  //    })
  // 3. 写入 PID 文件
}

function stopGateway() {
  // 1. 读取 PID 文件
  // 2. process.kill(pid, 'SIGTERM')
  // 3. 删除 PID 文件
}
```

### 日志查看

```javascript
function showLogs() {
  const logFile = '~/.config/mafw/logs/gateway.log';
  // tail -50 行
  const lines = fs.readFileSync(logFile).split(/\r?\n/);
  console.log(lines.slice(-50).join('\n'));
}
```

---

## MafwScheduler 详细设计

**文件**：`gateway/src/index.ts`（~800 行）

### 类结构

```typescript
class MafwScheduler {
  // ── 状态 ──
  private projectDir: string;              // 工作目录
  private mafwDir: string;                 // .opencode/mafw/
  private running: boolean;                // 是否运行中
  private serveProcess?: ChildProcess;     // opencode serve 进程
  private serveRunning: boolean;           // serve 是否就绪
  private sdkClient?: ReturnType<typeof createOpencodeClient>;
  private registeredProjects: Set<string>; // 已注册项目

  // 状态文件缓存
  private activeGoals: Map<string, GoalState>;
  private pollInterval?: NodeJS.Timeout;
  private dashboard?: DashboardServer;
}
```

### 启动流程

```typescript
async start(): Promise<void> {
  this.running = true;

  // 1. 启动 opencode serve
  await this.startServe();
  // spawn opencode.exe serve --port 4096
  // 等待 stdout 出现 "listening on"

  // 2. 初始化 SDK 客户端
  await this.initSDK();
  // createOpencodeClient({ port: 4096 })

  // 3. 启动 Dashboard
  this.dashboard = new DashboardServer(3001, this.projectDir, this);
  await this.dashboard.start();

  // 4. 注册已有项目
  await this.registerProjects();
  // 读取 projects.json → POST /register

  // 5. 崩溃恢复
  await this.recoverAll();

  // 6. 启动轮询
  this.pollInterval = setInterval(() => this.pollLoop(), 5000);

  // 7. 兜底轮询（30 秒，serve 不可用时）
  setInterval(() => this.pollLoop(), 30000);
}
```

### 轮询逻辑

```typescript
private async pollLoop(): Promise<void> {
  const stateDir = path.join(this.mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return;

  const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      const key = state.goalId || file.replace('.json', '');
      this.activeGoals.set(key, { ...state, goalId: key });

      switch (state.nextAction) {
        case 'CREATE_PLAN_SESSION':
          await this.startNextLoop(key);
          break;
        case 'CREATE_EXECUTE_SESSION':
          await this.scheduleGoal(key);
          break;
        case 'CREATE_REVIEW_SESSION':
          await this.scheduleReview(key);
          break;
        case 'ARCHIVE':
          await this.archiveGoal(key);
          break;
        case 'CANCELLED':
        case 'FAILED':
          // 标记但不处理
          break;
      }
    } catch {}
  }
}
```

### Session 调度

```typescript
private async scheduleGoal(goalId: string): Promise<void> {
  const sessionManager = new SessionManager(this.projectDir, this.sdkClient!);
  const session = await sessionManager.createSession(goalId, 'mafw-execute');

  // 等待完成（轮询 session 状态）
  while (this.running) {
    const status = await sessionManager.getSessionStatus(session.id);
    if (status === 'completed' || status === 'failed') break;
    await sleep(2000);
  }
}

private async archiveGoal(goalId: string): Promise<void> {
  // 1. Git tag 归档
  const { archiveWorktree } = await this.loadArchiveModule();
  try {
    await archiveWorktree(goalId, this.projectDir);
  } catch {
    console.error(`[Scheduler] Archive failed for ${goalId}`);
  }
  // 2. 更新状态
  await updateState(goalId, { phase: 'ARCHIVED', nextAction: 'COMPLETED' }, this.projectDir);
}
```

### Serve 管理

```typescript
private async startServe(): Promise<void> {
  const opencodeExe = this.resolveOpencode();

  this.serveProcess = spawn(opencodeExe, [
    'serve', '--port', '4096', '--hostname', '127.0.0.1'
  ], {
    cwd: this.projectDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PATH: process.env.PATH },
    windowsHide: true     // 防止 Windows 弹窗
  });

  // 等待 serve 就绪
  await this.waitForServe();
}

private resolveOpencode(): string {
  // 1. 尝试 PATH 中的 opencode
  // 2. 回退到 npm 全局 prefix
  // 3. 回退到 ~/.npm-global
  const npmRoot = execSync('npm root -g').toString().trim();
  return path.join(npmRoot, 'opencode-ai', 'bin', 'opencode.exe');
}
```

---

## DashboardServer 详细设计

**文件**：`gateway/src/dashboard/server.ts`（~140 行）

### 类结构

```typescript
class DashboardServer {
  private port: number;                    // 3001
  private server?: http.Server;
  private api: DashboardAPI;               // REST API
  private publicDir: string;               // __dirname + '/public'
  private sseClients: Set<http.ServerResponse>;
}
```

### HTTP 路由

```typescript
http.createServer(async (req, res) => {
  const url = req.url || '/';

  // 1. SSE 事件流
  if (url === '/api/events?stream=true' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('data: {"type":"connected"}\n\n');
    this.sseClients.add(res);
    req.on('close', () => this.sseClients.delete(res));
    return;
  }

  // 2. API 路由
  if (url.startsWith('/api/')) {
    await this.api.handle(req, res);
    return;
  }

  // 3. 静态文件
  const filePath = this.resolveFilePath(url);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
    return;
  }

  // 4. SPA fallback: 非 API/文件路由 → index.html
  const indexPath = path.join(this.publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(indexPath));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});
```

### SSE 广播

```typescript
broadcast(event: { type: string; [key: string]: any }): void {
  const data = `data: ${JSON.stringify({
    ...event,
    timestamp: new Date().toISOString()
  })}\n\n`;

  for (const client of this.sseClients) {
    try { client.write(data); }
    catch { this.sseClients.delete(client); }
  }
}
```

### MIME 类型映射

```typescript
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
```

### 静态文件解析

```typescript
private resolveFilePath(url: string): string | null {
  let cleanUrl = url.split('?')[0].split('#')[0];
  if (cleanUrl === '/') return null;  // 交给 SPA fallback
  return path.join(this.publicDir, cleanUrl);
}
```

---

## DashboardAPI 详细设计

**文件**：`gateway/src/dashboard/api.ts`（~1100 行）

### 架构模式：双路径

DashboardAPI 支持两种数据源，自动切换：

```
请求
  │
  ├── 运行时路径 (this.scheduler !== undefined)
  │     从 MafwScheduler 的内存 activeGoals Map 读取
  │     速度快，无需 IO
  │     但字段有限（只有 state.json 中的字段）
  │
  └── 文件系统路径 (this.scheduler === undefined)
        从 .opencode/mafw/ 目录读取 JSON 文件
        速度慢，但数据完整
        用于 Plugin 直接访问 Dashboard 的场景
```

### 类结构

```typescript
class DashboardAPI {
  private projectDir: string;
  private mafwDir: string;         // .opencode/mafw/
  private scheduler?: SchedulerState;

  async handle(req, res): Promise<void> {
    // URL 路由 → 调用对应方法 → JSON 响应
  }

  // ── Goal 相关 ──
  private getGoalsFromRuntime(): any[]   // 从 scheduler.activeGoals
  private getGoalsFromFS(): any[]        // 从 state/*.json

  // ── Stats 相关 ──
  private getStatsFromRuntime(): any     // 运行时统计
  private getStatsFromFS(): any          // 文件系统统计

  // ── Session 相关 ──
  private getSessionsFromRuntime(): any[]
  private getSessionsFromFS(): any[]

  // ── Memory 相关 ──
  private getMemory(goalId, tier?): any  // 谐波记忆读取
  private searchMemory(goalId, query): any

  // ── Cost 相关 ──
  private getCosts(goalId, loop?): any
  private getCostSummary(): any

  // ── Alignment 相关 ──
  private getAlignment(goalId?): any

  // ── Gateway 控制 ──
  private gatewayControl(action, goalId): any

  // ── LLM 代理 ──
  llmCompress(observations, model?): any
  parseLLMResponse(text): any
  private loadLLMConfig(): any
}
```

### 路由处理

`handle()` 方法是一个大的 `if-else` 链，匹配 `pathname + method`：

```typescript
async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const url = req.url || '/';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    // 精确路径
    if (pathname === '/api/health' && method === 'GET') { ... }
    if (pathname === '/api/goals' && method === 'GET') { ... }

    // 正则参数路径
    const loopMatch = pathname.match(/^\/api\/goals\/([^/]+)\/loops\/(\d+)$/);
    if (loopMatch && method === 'GET') { ... }

    // POST（需要读 body）
    if (pathname === '/api/feedback' && method === 'POST') {
      const body = await this.readBody(req);
      ...
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

### 关键端点实现细节

#### GET /api/stats — 聚合统计

运行时路径 (`getStatsFromRuntime`)：
- 遍历 `scheduler.activeGoals` Map
- 统计: activeGoalCount / loopsToday / wavesToday / activeSessions
- 从 FS 读取 `memory` 目录 → 计算 memoryEntries
- 从 FS 读取 `reviews` 目录 → 计算 loopSuccessRate
- 从 FS 读取 `cost` 目录 → 计算 agentPcts

文件系统路径 (`getStatsFromFS`)：
- 扫描 `state/*.json` → 统计 goals/loops/waves/sessions
- 计算总运行时长 (最早 updatedAt → 现在)
- 扫描 `lessons/`、`parametric/` → 分层计数

#### GET /api/memory/:goalId — 谐波记忆

```typescript
private async getMemory(goalId: string, tier?: string): Promise<any> {
  // 扫描 lessons/ + parametric/ 目录
  // 按文件名/路径推断层级 (L2/L3/T1/T2/T3/T4)
  // 返回 { tiers: { L5, T4, T3, T2, T1 }, entries: [...], total: N }
}
```

#### POST /api/llm/compress — LLM 代理

```typescript
async llmCompress(observations: string[], model?: string): Promise<any> {
  const config = this.loadLLMConfig();  // .mafw/llm-config.json
  const apiKey = process.env[config.compression.apiKeyEnv];

  if (config.compression.provider === 'anthropic') {
    // POST https://api.anthropic.com/v1/messages
    // model: claude-3-haiku-20240307
    // 返回 { narrative, facts, concepts, energy }
  }

  if (config.compression.provider === 'openai') {
    // POST https://api.openai.com/v1/chat/completions
  }

  // 失败回退: { narrative: 'error...', facts: [], concepts: [], energy: 0.3 }
}
```

#### POST /api/gateway/pause — 暂停 Goal

```typescript
case 'pause':
  state._resumePhase = state.phase;   // 保存恢复点
  state.phase = 'PAUSED';
  state.nextAction = 'PAUSED';
  break;

case 'resume':
  state.phase = state._resumePhase;    // 恢复
  state.nextAction = state._resumePhase === 'PLANNING' ? 'CREATE_PLAN_SESSION' : ...;
  delete state._resumePhase;
  break;
```

---

## RecoveryManager 详细设计

**文件**：`gateway/src/recovery.ts`（~90 行）

### Checkpoint 存储

```
.opencode/mafw/checkpoints/{goalId}/
├── loop-{loop}.json                    ← Loop 级快照
└── wave-{loop}-{waveNum}.json          ← Wave 级快照 (v6.0)
```

### 方法详解

```typescript
class RecoveryManager {
  constructor(private projectDir: string)

  // 保存 Checkpoint (v6.0: 支持 Wave 级)
  saveCheckpoint(goalId, loop, data, waveNum?): void {
    const name = waveNum !== undefined
      ? `wave-${loop}-${waveNum}.json`
      : `loop-${loop}.json`;
    // 原子写入
    fs.writeFileSync(path, JSON.stringify(checkpoint));
  }

  // 查找最近 Checkpoint (v6.0: 修复了数字排序)
  findLastCheckpoint(goalId): string | null {
    // 数字排序: wave-1-10.json > wave-1-2.json (正确)
    // 原来: string sort → wave-1-2.json > wave-1-10.json (错误)
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.json$/)[1]);
        const numB = parseInt(b.match(/(\d+)\.json$/)[1]);
        return numB - numA;
      });
  }

  // 恢复 Loop (v6.0: 支持 Wave 回滚)
  async restoreLoop(goalId, loop, targetWaveNum?): Promise<boolean> {
    // 1. 找到 Checkpoint 文件
    // 2. 恢复 state.json
    // 3. 若 targetWaveNum 有值，截断 waves.json
  }

  // 崩溃后恢复所有 RUNNING 状态的 Goal
  async recoverAll(callback): Promise<void> {
    // 扫描 STATUS.md
    // 找到 state === 'RUNNING' 的 Goal
    // 对每个 Goal 调用 callback(goalId, checkpointPath)
  }
}
```

### 崩溃恢复流程

```
Gateway 崩溃重启
    │
    ├── 1. MafwScheduler.start()
    │
    ├── 2. RecoveryManager.recoverAll()
    │       │
    │       ├── 读取 STATUS.md
    │       ├── 找到 state=RUNNING 的 Goal
    │       ├── 调用 callback(goalId, checkpoint)
    │       │
    │       └── callback:
    │           ├── 创建新 Session
    │           ├── 加载 Checkpoint 状态
    │           └── 从断点继续
    │
    └── 3. pollLoop() 接管
```

---

## SessionManager 详细设计

**文件**：`gateway/src/session-manager.ts`（~60 行）

```typescript
class SessionManager {
  constructor(
    private projectDir: string,
    private sdk: ReturnType<typeof createOpencodeClient>
  ) {}

  async createSession(goalId: string, skill: string) {
    // 1. 创建 Session
    const session = await this.sdk.sessions.create({
      projectDir: this.projectDir
    });

    // 2. 发送 Skill 命令
    await this.sdk.sessions.sendMessage(session.id, {
      role: 'user',
      parts: [{ text: `/skill ${skill} ${goalId}` }]
    });

    return session;
  }

  async getSessionStatus(sessionId: string) {
    const session = await this.sdk.sessions.get(sessionId);
    return session.status; // 'active' | 'completed' | 'failed'
  }
}
```

---

## API 端点完整列表

### Goald 管理

| 端点 | 方法 | 运行时实现 | 文件系统实现 |
|---|---|---|---|
| `/api/goals` | GET | 遍历 `scheduler.activeGoals` → map 为 `{goalId, phase, loop, ...}` | 扫描 `state/*.json` |
| `/api/goals/:id` | GET | — | 读 `state/{id}.json` + `requests/{id}.json` + `waves.json` |
| `/api/goals/:id/loops` | GET | — | 扫描 `reviews/{id}-loop*.md` |
| `/api/goals/:id/loops/:loop` | GET | — | 读 `lessons/` + `receipts/{id}/` + `reviews/{id}-loop{N}.md` |

### Session 管理

| 端点 | 方法 | 运行时 | 文件系统 |
|---|---|---|---|
| `/api/sessions` | GET | 遍历 activeGoals → 收集活跃 Session | 遍历 state/*.json → 收集 sessions 对象 |
| `/api/sessions/:id/metrics` | GET | — | 读 state 文件 + cost 数据估算 Token |

### 统计

| 端点 | 方法 | 运行时 | 文件系统 |
|---|---|---|---|
| `/api/stats` | GET | 内存数据 + FS 回退 | 全量计算 |

### 记忆

| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/memory/:goalId` | GET | 扫描 lessons/ + parametric/ 目录 |
| `/api/memory/:goalId/:tier` | GET | 按 tier 过滤 |
| `/api/memory/search` | GET | 全量 → 客户端文本搜索 |
| `/api/memory/energy-distribution` | GET | 关键词启发式打分 |

### 成本

| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/costs/:goalId` | GET | 读 `cost/{goalId}.json` |
| `/api/costs/summary` | GET | 聚合所有 `cost/*.json` |

### 反馈与对齐

| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/feedback` | GET | 读 `user-feedback/*/*.json` |
| `/api/feedback` | POST | 调用 `run-record-feedback` |
| `/api/alignment` | GET | 读 `requests/{id}.json` + `cost/{id}.json` |
| `/api/alignment` | POST | 写 `user-weights.json` |
| `/api/user-answers/:id` | POST | 读 `user-questions/*/{id}.json` |

### Gateway 控制

| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/gateway/pause` | POST | 写 `_resumePhase` + `phase=PAUSED` |
| `/api/gateway/resume` | POST | 恢复 `_resumePhase` |
| `/api/gateway/cancel` | POST | `phase=FAILED` |
| `/api/gateway/checkpoint` | POST | RecoveryManager 批量保存 |
| `/api/gateway/rollback` | POST | RecoveryManager 回滚 |

### LLM 代理

| 端点 | 方法 | 实现 |
|---|---|---|
| `/api/llm/compress` | POST | 调用 Anthropic/OpenAI API |

---

## 数据流全景

### Goal 从创建到完成

```
用户 /goal 设计登录系统
    │
    ▼
Plugin → 写入 state/{id}.json { nextAction: 'CREATE_PLAN_SESSION' }
    │
    ▼
Gateway 轮询 (5s) → 发现 nextAction
    │
    ├── SessionManager.createSession(id, 'mafw-plan')
    ├── Session 完成 → Agent 写入 state → nextAction = 'CREATE_EXECUTE_SESSION'
    │
    ▼
轮询 → SessionManager.createSession(id, 'mafw-execute')
    │
    ├── Execute Agent 逐 Wave 执行
    ├── 每 Wave: 代码 → 测试 → 提交 → Receipt
    ├── 所有 Wave 完成 → state → nextAction = 'CREATE_REVIEW_SESSION'
    │
    ▼
轮询 → SessionManager.createSession(id, 'mafw-review')
    │
    ├── Review Agent → 产出 Review 报告
    ├── 状态机: PASS→归档 / FAIL→新 Loop / PARTIAL→重试
    │
    ▼
归档 → archiveGoal() → Git tag + state.phase = 'ARCHIVED'
```

### 事件推送流

```
Plugin updateState()
    │
    ├── 原子写入 state/{id}.json (tmp + rename)
    ├── POST /api/events { type: 'state_change', goalId, patch }
    │
    ▼
Gateway 收到 POST /api/events
    │
    ├── 更新 scheduler.activeGoals 缓存
    ├── DashboardServer.broadcast({ type: 'state_change', ... })
    │
    ▼
Dashboard SSE → EventSource.onmessage → 刷新 UI
```

### 文件系统读写流

```
Plugin (write path)                     Gateway/Dashboard (read path)
    │                                           │
    ├── state/{id}.json  (原子写入)      ◄──────├── 轮询读取
    ├── cost/{id}.json                   ◄──────├── GET /api/costs
    ├── user-feedback/{id}/              ◄──────├── GET /api/feedback
    ├── user-questions/{id}/             ◄──────├── POST /api/user-answers
    └── memory/tier*/                   ◄──────├── GET /api/memory
```

### 多组件协作流（Search 示例）

```
Agent 调用 mafw_search_hybrid
    │
    ▼
Plugin 内部:
    │
    ├── executeHybridSearch()
    │   ├── BM25 (memory-index.ts)
    │   ├── 向量 (vector-index.ts)
    │   ├── 谐波索引 (HarmonicIndexManager)
    │   ├── RRF 融合
    │   ├── CognitiveGraph.addConnection()  (v6.4)
    │   └── Token 预算分配
    │
    ├── CostEstimator.recordToolCall()
    ├── persistCosts() → SQLite + JSON
    │
    ▼
返回结果给 Agent
    │
    ▼
SSE Dashboard → 刷新
```

---

## 配置

### 目录结构

```
~/.config/mafw/
├── gateway.pid              # 进程 PID
├── logs/
│   └── gateway.log          # 日志文件 (滚动, max 50 行 tail)
├── config.json              # 用户配置
└── projects.json            # 已注册的项目列表
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MAFW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway API 地址 |
| `PORT` | 3000 | HTTP API 端口 |
| `DASHBOARD_PORT` | 3001 | Dashboard 端口 |
| `MAFW_LLM_API_KEY` | — | LLM 压缩 API Key (Anthropic/OpenAI) |
| `MAFW_STORAGE_BACKEND` | `file` | 存储后端 |
| `MAFW_LOG_LEVEL` | `info` | 日志级别 |

### 命令行

```bash
npx mafw-gateway --help

MAFW Gateway CLI v5.0

Commands:
  start              Start Gateway in foreground
  daemon             Start Gateway in background
  stop               Stop running Gateway
  status             Show Gateway status
  restart            Restart Gateway
  dashboard          Open Dashboard in browser
  service-register   Register as system service (auto-start)
  service-unregister Unregister system service
  logs               Show recent logs
  config             Show/edit configuration
```

---

## 跨平台服务注册

Gateway 支持三种系统服务注册方式：

```javascript
function registerService() {
  const platform = process.platform;

  if (platform === 'win32') {
    // schtasks (任务计划程序)
    // 开机自启，最高权限
    execSync(`schtasks /create /tn "MAFW-Gateway" /tr "node ${script}" /sc onlogon /rl highest /f`);
  }

  if (platform === 'darwin') {
    // LaunchAgent
    // 用户级守护进程
    fs.writeFileSync(plistPath, plist);
    execSync(`launchctl load "${plistPath}"`);
  }

  if (platform === 'linux') {
    // systemd user service
    fs.writeFileSync(unitPath, unit);
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable mafw-gateway.service');
  }
}
```

### 各平台服务配置

| 平台 | 机制 | 文件位置 |
|---|---|---|
| Windows | schtasks | 任务计划程序 (GUI 可见) |
| macOS | LaunchDaemon | `~/Library/LaunchAgents/com.mafw.gateway.plist` |
| Linux | systemd | `~/.config/systemd/user/mafw-gateway.service` |
