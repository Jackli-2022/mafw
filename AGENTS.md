# MAFW Agent 规范 v6.8

## 1. 架构原则

- Interview 后全自动：用户只确认 Goal Charter，之后零干预
- Ralph Loop 迭代：Plan → Execute → Review → 自动重试直到完成
- Wave 并行：Wave 内 Task 并行，Wave 间串行
- 磁盘记忆：所有状态写进仓库，Agent 会忘，repo 不会
- 成本感知：Cognitive Router 根据预算自动降级模型，CostEstimator 追踪每次调用
- 用户对齐：mafw_ask_user 非阻塞提问，mafw_record_feedback 修正记忆能量
- 记忆生长：显著度保护、联想网络、间隔复习、抽象蒸馏（v6.4）
- 零 LLM 依赖：所有认知引擎纯规则驱动

## 2. Agent 定义

### 2.1 Goal Agent
- 职责：Interview 阶段，追问确立目标/指标/边界
- 输出：Goal Charter（goals/{id}.md）
- 交互：用户确认前唯一可交互点

### 2.2 Plan Agent
- 职责：拆解 Task，划分 Wave
- 输入：Goal Charter + L2 Lessons + L3 Δ + L1 Wave Digest
- 输出：waves.json + tasks/{id}.md

### 2.3 Execute Agent
- 职责：编写代码，生成 Receipt
- 输入：Task 定义 + L3 Constraint Δ + L3 Prompt Δ
- 输出：代码变更 + Receipt

### 2.4 Reviewer
- 职责：审查代码，输出 Review 报告
- 输入：Goal Charter + Task 定义 + Receipt + Diff + L3 Constraint Δ
- 输出：Review 报告（verdict / metrics_check / boundary_check / code_quality / critical_issues / warnings / suggestions / handoff_suggestion / delta_compliance）

### 2.5 Memory Extractor Agent
- 职责：从 Review 失败中提取参数化记忆（Δ）
- 输入：L2 YAML Lesson + Review 报告 + AGENTS.md
- 输出：0~2 个 Δ yaml

### 2.6 Cognitive Router（v6.0）
- 职责：Agent 级别动态模型选择
- 输入：剩余 Token 预算、总预算、Agent 类型
- 输出：`{ model: string, reason: string }`
- 规则：`usage > 80% && agentType === 'execute'` → 切换 Haiku

### 2.7 Cost Accountant（v6.0）
- 职责：记录每次 Tool 调用的估算 Token/成本
- 输入：`ToolCallRecord { goalId, loopNum, toolName, input }`
- 输出：`CostRecord` 持久化到 `cost_logs` 表 + JSON 文件

### 2.8 Alignment Agent（v6.0）
- 职责：追踪用户反馈，更新记忆能量
- 输入：`FeedbackInput { targetId, type, goalId }`
- 输出：`FeedbackOutput { energyDelta }`
- 规则：thumbs_up → +0.2, thumbs_down → -0.1

### 2.9 Salience Perceptor（v6.4 新增）
- 职责：自动识别观察内容的显著度
- 输入：原始观察文本
- 输出：salience 值 (0.5 / 1.0 / 1.5)
- 规则：故障/错误 → 1.5，常规日志 → 0.5，默认 → 1.0
- 影响：高显著度记忆衰减慢 3 倍

### 2.10 Review Scheduler（v6.4 新增）
- 职责：后台调度记忆复习任务
- 算法：艾宾浩斯曲线 `1 * 2^reviewCount` 天
- 输出：复习队列 `memory/.review_queue.json`

### 2.11 Abstraction Distiller（v6.4 新增）
- 职责：从重复记忆中提炼更高层次知识
- 规则一：≥3 条相似 T2 叙事 → 合并为 1 条 T3 事实
- 规则二：≥5 次成功 T4 流程 → 上升为 L5 全局启发式

## 3. 谐波记忆系统（v6.3）

### 3.1 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  goal_id: string | null;
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;    // 6-8 词核心摘要
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // v6.4: 0.5~1.5
  abstraction_level?: number;     // v6.4: 0=T1, 1=T2, 2=T3/T4, 3=L5
  review_count?: number;          // v6.4: 复习次数
  last_reviewed?: string;         // v6.4: 上次复习
  top_associations?: string[];    // v6.4: 联想预取
  merged_from?: string[];
  created_at: string;
  updated_at: string;
}
```

### 3.2 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → BM25 扫描 .harmonic_index.json（无视 memory_type）
     → 按 energy × BM25 排序
     → 按需从 tier 文件加载完整 memory_value
     → 联想预取 top_associations
```

### 3.3 压缩

`HybridCompressor.compress()` 输出 `HarmonicUnit` 并自动：
1. 计算显著度
2. 写入对应 tier 文件
3. 更新 `.harmonic_index.json`
4. 触发 MinHash 跨层合并检查

## 4. Tools 清单（v6.8 总共 14 个）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | BM25 + RRF 谐波检索 + 联想预取 |
| `mafw_get_deltas` | 获取参数化约束（L3） |
| `mafw_update_state` | 更新状态文件 |
| `mafw_load_state` | 读取状态文件 |
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |
| `mafw_add_memory` | 写入记忆单元 |
| `mafw_commit_heuristic` | 提交 L5 启发式 |
| `mafw_get_axioms` | 获取 L5 公理 |
| `mafw_merge_memory` | ★ 跨 worktree 记忆融合 |

## 5. v6.8 新增系统

### 5.1 统一配置管理
- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值
- 所有端口/URL/超时/路径集中在 `gateway/src/config.ts`
- 环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）

### 5.2 记忆与 Goal 解耦
- `HarmonicUnit.goal_id` 可选 —— 记忆不绑定任何 Goal
- 所有 Hooks 在无 goal 上下文时照常运行
- `askUser`/`recordFeedback` 存储路径扁平化（不再按 goal 分目录）
- `CostEstimator.ToolCallRecord.goalId` 改为可选

### 5.3 记忆融合系统（git worktree）
- `mafw_merge_memory` MCP 工具：MinHash 比对，提取独有记忆（energy=0.4）
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` 在 git merge 前调用 `mergeMemoryFromWorktree()`
- 融合记录写入 `.mafw/fusion-log.jsonl`
- CLI 命令：`/worktree-list`、`/worktree-prune`、`/merge-memory`

### 5.4 文件日志系统
- `installFileLogging()` 劫持全局 `console.log/warn/error`
- 所有插件/Hooks/Skills 输出自动写入 `.mafw/logs/mafw.log`
- 格式：`[ISO时间戳] [LEVEL] 原始消息`
- 5MB 自动轮转

### 5.5 Desktop 前端（opencode-dev/packages/desktop/）
- Electron + SolidJS + `@opencode-ai/ui`
- utilityProcess 侧车运行 Gateway
- 主 UI：左侧 Rail(200px) + 上部 TabStrip + 内容区

### 5.6 Rail 侧边栏数据流
Rail 通过 `window.api.mafw.invoke(namespace, method, ...args)` 从 Gateway SDK 获取数据：
```
onMount → gateway.info() 等 ready
       → invoke("project", "list")       → GET /api/projects
       → invoke("project", "current")    → GET /api/projects/current
       → invoke("session", "list", pid)  → GET /api/sessions?projectID=...
```
注意：`project.current()` 返回的是 `Project` 对象本身，不是 `{ project: Project }` 信封。
点击"All projects"里的其他项目时，同时调 `invoke("project", "setCurrent", path)` 同步到 gateway。

所有 data fetching 在组件内 inline 使用 `createEffect`，无独立 hook。
轮询间隔：Dashboard 15s / Approvals 10s / Triage 10s / Automations 10s。

### 5.10 UI 组件约定
- MAFW 禁止新增裸 `<button>`、`<input>`、裸 `title` 属性，一律用 `@opencode-ai/ui/v2/*` 组件
- 按钮用 `ButtonV2`（variant: contrast/outline/ghost）
- 文本输入用 `TextInputV2`
- 开关用 `SwitchV2`
- 提示用 `TooltipV2`（统一 `openDelay: 300`）
- 加载用 `LoaderV2`
- 通知用 `ToastV2`（统一 `toastStore` 入口）

### 5.7 Gateway 启动顺序
```
start()
  ├─ installFileLogging()              → ~/.mafw/logs/mafw.log
  ├─ initServices()                    → Memory + Cost + MCP + Automation
  ├─ startApiServer()                  → HTTP API on port 3000
  ├─ init SDK client                   → @opencode-ai/sdk
  ├─ probe isServeHealthy()            → 先探已有 opencode server
  │   ├─ 通 → 直接复用
  │   └─ 不通 → startServe() → waitForServeReady() ×60s
  │       └─ 超时 → MCP-only mode
  ├─ recoverConfig / recoverRegistry   → 恢复注册表
  ├─ recoverState                      → 恢复活跃 Goal
  └─ automationEngine.start()          → 轮询 + 事件监控
```
Server 启动失败不崩溃，优雅降级到 MCP-only 模式。

### 5.8 Desktop → Gateway 探测连接
`mafw-sidecar.ts:startGateway()` 优先探测已有 gateway：
```
probeExistingGateway()
  → 探测顺序：MAFW_SERVER_API_PORT → MAFW_GATEWAY_PORT → 3000
  → 调用 GET /health 确认
  → 通 → 直接设置 state="ready"，不 spawn
  → 不通 → 走 resolve → findFreePort → utilityProcess.fork
```
运行时健康检查每 30s 一次，连续 5 次失败后自动 restart。

### 5.9 Client SDK → Gateway IPC 通道
```
Renderer (SolidJS)                    Main Process                    Gateway
window.api.mafw.invoke(ns, m, args)
  └─ ipcRenderer.invoke("mafw-invoke")
       └─ mafw-ipc.ts
            └─ mafwClient[ns][m](...args)
                 └─ fetch("http://localhost:<port>/api/...")
                      └─ Gateway HTTP API
```
SSE 事件直接从前端 EventSource 连 gateway，不走 IPC。

## 6. 关键规范

### 6.1 加密算法
所有生产环境的认证系统必须使用 RS256 非对称加密算法。

### 6.2 测试覆盖率
测试覆盖率低于 80% 的代码必须标记为 DEGRADED，除非 Task 标签包含 "prototype" 或 "spike"。

### 6.3 边界测试
每个功能必须有边界测试（空值、超长输入、特殊字符、时序攻击）。

## 7. Gateway 运维

### 7.1 CLI 命令
Gateway 唯一运维入口是 `mafw` CLI，用 `npm install -g` 全局安装或 `npx mafw` 使用：

```bash
# 进程管理
mafw status            # 查看运行状态
mafw start             # 前台启动
mafw daemon            # 后台启动
mafw stop              # 停止
mafw restart           # 重启前台（stop + 1s + start）

# 日志和诊断
mafw logs              # 看最后 50 行
mafw health            # HTTP 健康检查
mafw stats             # gateway 统计

# 项目/Goal 管理
mafw projects          # 已注册项目
mafw goals             # 活跃 Goal
mafw register <dir>    # 注册项目

# 其他
mafw config            # 当前配置
mafw dashboard         # 打开 Web Dashboard
mafw version           # 版本号
```

### 7.2 日志路径
Gateway 的 console.log/warn/error 自动写入文件：
- `~/.mafw/logs/mafw.log` — 文件日志（daemon 模式下也用这个）
- 5MB 自动轮转，格式 `[ISO时间] [LEVEL] 消息`
- Error 对象在日志中需要用 `err.message` 而非 `err`（JSON.stringify Error → {}）

### 7.3 重启注意事项
- Restart 前会自动 kill 旧进程（基于 PID 文件）
- 如果旧进程是非 CLI 启动的，先 `mafw stop` 再 `mafw start`

### 7.4 构建与发布
```bash
npm run build           # 构建 plugin + gateway
npm pack                # 打包为 .tgz（317 kB）
npm run pack:install    # build → pack → npm install -g → verify
```
发布后用户只需 `npm install -g opencode-plugin-mafw` 即可使用 `mafw` CLI。

### 7.5 HTTP 路由注意事项
Gateway API 路由使用正则匹配，query string 会导致 `$` 锚定不匹配：
- 正确：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)`
- 错误：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages$/)`（不匹配 `?limit=100`）
