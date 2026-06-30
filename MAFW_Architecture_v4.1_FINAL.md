# MAFW Loop Agent — 架构最终定稿 v4.1

> 版本: 4.1-FINAL  
> 日期: 2026-06-25  
> 状态: 已冻结，进入实施  
> 核心理解:
>   - MAFW 是一个标准 npm 包：`opencode-plugin-mafw`
>   - **安装方式：`npm install -g opencode-plugin-mafw`（全局）或 `npm install --save-dev`（本地）**
>   - **`opencode.json` 格式：`{ "plugin": ["superpowers@...", "opencode-plugin-openspec", "opencode-plugin-mafw"] }`**
>   - **绝不修改 `opencode.json`**，用户手动添加 `"opencode-plugin-mafw"` 到 `plugin` 数组
>   - OpenCode 通过 npm 包名自动解析插件入口和 Skill 路径
>   - **Gateway** 是独立系统级常驻进程（参考 OpenClaw Gateway），负责 OpenCode Serve 生命周期 + 轮询编排
>   - Gateway 通过 `npx mafw-gateway` CLI 管理，支持跨平台系统服务注册
>   - 一个 Gateway 实例服务多个项目，项目通过插件 `activate()` 自动注册
>   - TUI 和 Serve 是 OpenCode 的两个进程，插件同时加载所有能力
>   - 所有 Agent 必须 Session 隔离：Plan / Execute / Review 各自独立 Session
>   - 业务判断（verdict、loop 计数、状态流转）由插件 Skill Entry 显式写入 `state.json`，Gateway 只读
>   - 状态更新是主路径，写在 Skill Entry 函数末尾；Hook 只做异常兜底
>   - 远程 CLI 是唯一的 Connector，Execute 自动同步，Review 自动拉取结果
>   - Worktree 按 Goal 隔离，Task 用 Git 分支隔离
>   - 三层记忆 + 三层压缩
>   - Prompt 拼接由插件内部 tool 函数完成
>   - Review 失败由插件代码判断，写入 Lesson → 更新 state → Gateway 创建新 Loop
>   - STATUS.md 心跳由插件代码更新，Gateway 监控
>   - **Automation Engine 是 Gateway 子模块：只负责"发现需要 Agent 做的工作"，不直接执行**
>   - Commit 规范：`type(scope): description`，scope ∈ {gateway, plugin, connector, memory, docs, automation}

---

## 目录

1. [架构总览](#1-架构总览)
2. [核心概念](#2-核心概念)
3. [组件定义](#3-组件定义)
4. [Gateway 常驻模式](#4-gateway-常驻模式)
5. [安装与部署](#5-安装与部署)
6. [数据流](#6-数据流)
7. [文件契约](#7-文件契约)
8. [MAFW 插件](#8-mafw-插件)
9. [Gateway 核心](#9-gateway-核心)
10. [Ralph Loop 引擎（Phase 接力）](#10-ralph-loop-引擎phase-接力)
11. [状态更新机制](#11-状态更新机制)
12. [Worktree 隔离](#12-worktree-隔离)
13. [三层记忆与压缩](#13-三层记忆与压缩)
14. [远程 CLI 集成](#14-远程-cli-集成)
15. [降级策略](#15-降级策略)
16. [Dashboard 看板](#16-dashboard-看板)
17. [文件结构](#17-文件结构)
18. [实施路径](#18-实施路径)
19. [Commit 规范](#19-commit-规范)

---

## 1. 架构总览

```
用户执行 npm install -g opencode-plugin-mafw
    │
    ▼
┌─────────────────────────────────────────────┐
│ npm 全局安装                                  │
│  ├─ 插件代码安装到全局 node_modules            │
│  ├─ 可选：注册系统级 Gateway 服务（全局安装时）  │
│  └─ 绝不修改任何用户文件（包括 opencode.json）   │
└─────────────────────────────────────────────┘
    │
    ▼
用户手动编辑 opencode.json，添加 "opencode-plugin-mafw"
    │
    ▼
用户执行 opencode（启动 TUI）
    │
    ▼
OpenCode 读取 opencode.json
    ├─ 解析 plugin 数组中的 "opencode-plugin-mafw"
    ├─ 从全局 node_modules 加载插件包
    ├─ 扫描插件包内的 .opencode/skills/ 目录
    └─ 加载插件入口（package.json 中 opencode.plugin 字段）
    │
    ▼
MAFW 插件 activate()
    ├─ 注册所有命令（/goal, /status, /triage...）
    ├─ 注册 hooks（异常兜底）
    └─ 向 Gateway 注册项目（POST localhost:3000/register）
        ├─ 探测 localhost:3000/health
        ├─ 无响应 → 提示用户启动 Gateway
        └─ 有响应 → 传递 projectDir + mafwDir
    │
    ▼
用户输入: /goal 设计登录系统
    │
    ▼
MAFW 插件调用 mafw-goal Skill → Interview Agent 追问 → 用户确认
    │
    ▼
写入 goals/001-auth.md + requests/001-auth.json + STATUS.md + state/001-auth.json
    │
    ▼
TUI 显示: "Goal 已确认，后台即将启动"
TUI 可关闭
    │
    │ 文件系统 (磁盘记忆)
    ▼
Gateway (系统级常驻进程) 轮询已注册项目
    ├─ 读取 ~/.config/mafw/config.json（项目索引）
    ├─ 遍历每个项目的 mafwDir/state/*.json
    │   ├─ 检查 mafwDir 是否存在（stale entry 清理）
    │   └─ 不存在则删除注册项并重写注册表
    └─ 发现 D:/Projects/myapp/.opencode/mafw/state/001-auth.json
    │
    ▼
Gateway 读取 state/001-auth.json
    ├─ nextAction: "CREATE_PLAN_SESSION"
    ├─ loop: 1
    └─ 读取 requests/001-auth.json 获取配置
    │
    ▼
Gateway: POST localhost:4096/session
    ├─ Header: X-OpenCode-Directory: D:/Projects/myapp
    └─ Body: {metadata: {mafw: true}}
    │
    ▼
OpenCode Serve 创建 Plan Session (directory=D:/Projects/myapp)
    │
    ▼
Gateway: POST /session/{id}/prompt_async
    └─ Body: {message: "/skill mafw-plan 001-auth"}
    │
    ▼
Plan Agent 执行（独立 Session）
    ├─ 读取 goals/001-auth.md (L1)
    ├─ 读取 lessons/ (L2 检索)
    ├─ 加载 parametric/ Δ (L3 注入)
    ├─ 拼接完整 Prompt
    ├─ 调用 LLM
    ├─ 解析回复为 waves.json
    ├─ 写入 tasks/{id}.md
    └─ 【显式】更新 state/001-auth.json:
        { nextAction: "CREATE_EXECUTE_SESSION", phase: "PLANNING_COMPLETE" }
    │
    ▼
Plan Session 正常结束
    ├─ 插件 hook 'session-ending' 触发（异常兜底）
    └─ OpenCode 关闭 Session
    │
    ▼
Gateway 下一轮 poll 读取 state
    ├─ nextAction === CREATE_EXECUTE_SESSION
    ├─ 销毁 Plan Session (释放资源)
    └─ 创建 Execute Session
    │
    ▼
Execute Agent 执行（独立 Session，看不到 Plan 的上下文）
    ├─ 读取 waves.json
    ├─ Wave 1: Task 001-1, 001-2 并行执行
    ├─ 每个 Task: git checkout -b change/{task-id}
    ├─ 调用 LLM 编写代码
    ├─ 写入文件，git commit
    ├─ 合并 Wave 1 → goal/001-auth
    ├─ Wave 2: Task 001-3, 001-4 ...
    ├─ 远程 CLI 同步: remote-cli sync
    ├─ 远程 CLI 编译: remote-cli run "make test"
    ├─ 写入 receipts/001-auth/
    └─ 【显式】更新 state/001-auth.json:
        { nextAction: "CREATE_REVIEW_SESSION", phase: "EXECUTING_COMPLETE" }
    │
    ▼
Gateway 下一轮 poll 读取 state
    ├─ nextAction === CREATE_REVIEW_SESSION
    ├─ 销毁 Execute Session
    └─ 创建 Review Session
    │
    ▼
Review Agent 执行（独立 Session，看不到 Execute 的上下文）
    ├─ 读取 Goal Charter 指标
    ├─ 读取 receipts/001-auth/
    ├─ 读取 git diff
    ├─ 读取远程 CLI 测试结果
    ├─ 拼接 Review Prompt
    ├─ 调用 LLM 审查
    ├─ 返回 verdict: FAIL
    ├─ 原因: "覆盖率 60% < 80%"
    ├─ 写入 reviews/001-auth-loop1.md
    ├─ 写入 lessons/001-auth-loop1.md
    ├─ LessonCompactor 压缩为 YAML (L2)
    ├─ MemoryExtractor 提取 Δ (L3)
    └─ 【显式】更新 state/001-auth.json:
        { nextAction: "CHECK_VERDICT", phase: "REVIEWING_COMPLETE", verdict: "FAIL" }
    │
    ▼
Gateway 读取 state → nextAction: CHECK_VERDICT
    ├─ 读取 review 文件（只读，不解析业务逻辑）
    ├─ verdict !== PASS
    ├─ loop (1) < maxLoops (5)
    └─ 更新 state:
        { nextAction: "CREATE_PLAN_SESSION", loop: 2, phase: "PLANNING" }
    │
    ▼
Loop 2:
    │
    ├── Plan Agent（新 Session）
    │   ├─ 读取 goals/001-auth.md
    │   ├─ 读取 lessons/001-auth-loop1.md (Loop 1 经验)
    │   ├─ 加载 parametric/ Δ (覆盖率约束已注入)
    │   ├─ 拼接 Prompt (自动带上覆盖率检查清单)
    │   ├─ 调用 LLM
    │   └─ 解析 Plan (已包含边界测试)
    │
    ├── Execute Agent（新 Session）
    │   └─ Task 002-1, 002-2 ... (代码自动包含测试)
    │       ├─ 远程 CLI 同步
    │       └─ 远程 CLI 编译测试
    │
    ├── Review Agent（新 Session）
    │   ├─ 调用 LLM 审查
    │   ├─ 读取远程测试结果
    │   ├─ 返回 verdict: PASS
    │   └─ 覆盖率: 85%
    │
    ├── Gateway 读取 verdict === PASS
    │   └─ 更新 state: { nextAction: "ARCHIVE" }
    │
    ▼
Archive（Gateway 或独立 Session）
    ├─ 合并 goal/001-auth → main
    ├─ L3 Validator 固化 Δ → AGENTS.md.runtime
    ├─ 生成报告 reports/001-auth.md
    └─ 更新 STATUS.md (state: COMPLETED)
    │
    ▼
Gateway 检测到 STATUS.md 状态变更
    │
    ▼
通知用户 (可选: 邮件/Slack/桌面通知)

═══════════════════════════════════════════════════════
【Automation 流程 — 通用定时任务，与手动 Goal 并行】
═══════════════════════════════════════════════════════

Gateway 启动时
    │
    ▼
Automation Engine 加载规则
    ├─ 读取 ~/.config/mafw/automations/*.json（全局）
    ├─ 读取 <project>/.opencode/mafw/automations/*.json（项目级）
    └─ 注册 Cron 定时器
    │
    ▼
【场景 A: 外部扫描 + Triage】每天早上 7:00
    │
    ▼
Automation Engine 触发 daily-github 规则
    ├─ 创建临时 Session → 运行 Skill: mafw-github-scanner
    ├─ Skill 执行: 扫描 GitHub open PRs, CI failures...
    ├─ Skill 返回 findings: [3 open PRs, 1 CI failure]
    ├─ onResult.type === "triage"
    └─ 写入 triage/20260624-070000-github.json
        { state: "PENDING_CONFIRMATION", proposedGoal: {...} }
    │
    ▼
用户打开 TUI，输入 /triage → 确认执行
    │
    ▼
转成 Goal → 进入 Phase 接力

【场景 B: 固定 Goal】每天凌晨 2:00
    │
    ▼
Automation Engine 触发 nightly-regression 规则
    ├─ 创建临时 Session → 运行 Skill: mafw-goal-generator
    ├─ Skill 执行: 生成预定义 Goal 配置
    ├─ Skill 返回 goalConfig
    ├─ onResult.type === "goal"
    ├─ 写入 requests/auto-nightly-20260624.json
    ├─ 写入 state/auto-nightly-20260624.json
    │   { nextAction: "CREATE_PLAN_SESSION" }
    └─ 无需 Triage，直接进入 Phase 接力
```

---

## 2. 核心概念

### 2.1 Ralph Loop（Phase 接力）

- **每轮 Fresh Context**: 不依赖会话历史，读取文件系统状态
- **Phase 接力**: Plan → Execute → Review 三阶段，每个阶段是独立 Session
- **Stop Hook 拦截**: Review 失败时不退出，Skill Entry 显式更新 state → 下一轮
- **Completion Promise**: 明确的完成信号（`nextAction: ARCHIVE`）
- **磁盘记忆**: 所有状态写入仓库，跨 Session 持久化

### 2.2 Phase

| Phase | 职责 | Session 隔离 | 可写范围 | 状态更新方式 |
|-------|------|-------------|---------|-------------|
| **PLANNING** | 生成 Waves 和 Tasks | 独立 Session | `waves.json`, `tasks/` | Skill Entry 末尾显式写 state |
| **EXECUTING** | 执行 Wave，编写代码 | 独立 Session | `receipts/`, `change/*` branches | Skill Entry 末尾显式写 state |
| **REVIEWING** | 审查产出，输出 verdict | 独立 Session | `reviews/`, `lessons/` | Skill Entry 末尾显式写 state |
| **ARCHIVED** | 合并、报告、清理 | Gateway 或独立 Session | `reports/`, `STATUS.md` | Gateway 直接处理 |

### 2.3 Wave

- **Wave 间**: 串行（有依赖关系）
- **Wave 内**: 并行（Task 无依赖，工具级并发）
- **每个 Task**: 独立 Git 分支 `change/{task-id}`，共享同一 Worktree 文件系统

### 2.4 Loop

- 同一个 Goal 可以有多个 Loop，由文件系统状态机驱动
- Loop 1 首次执行，Loop 2+ 基于历史 Lesson 改进
- 自动判断完成条件（指标 + 边界），无需用户干预

### 2.5 Gateway

- **本质**: 独立 Node.js 常驻进程，系统级服务（Windows 计划任务 / macOS launchd / Linux systemd）
- **职责**:
  1. 启动并监控 OpenCode Serve 子进程
  2. 启动 HTTP API 接收插件注册和控制指令
  3. 维护已注册项目索引（内存 + `~/.config/mafw/config.json` 持久化）
  4. 轮询已注册项目的 `state/*.json` 读取 `nextAction`，执行对应的 Session 创建/销毁
  5. 监控活跃 Session 心跳，卡死时重建 Session 从断点恢复
  6. 轮询时清理 stale entry（项目目录已删除的注册项）
  7. **运行 Automation Engine**（定时扫描外部系统，管理 Triage Inbox）
- **不碰**: 业务判断、verdict、loop 计数、Prompt 拼接、Wave 调度、Lesson 压缩
- **CLI 管理**: `npx mafw-gateway start|stop|status|restart|logs|daemon|service-register`

### 2.6 Automation（发现引擎）

- **本质**: Gateway 内部"发现引擎"，非独立进程。只发现工作，不执行工作
- **触发方式**: Cron 表达式（如 `0 7 * * *` 每天早上 7 点）
- **发现方式**: 通过**注册 Skill**执行发现工作，不是硬编码扫描逻辑
- **结果处理**: Skill 返回 findings → Automation Engine 决定放入 Triage 或直接创建 Goal
- **核心原则**: 凡是需要 Agent（LLM）参与的，必须变成 Goal，进入 Loop（Plan→Execute→Review）
- **不处理**: 纯脚本执行（日志清理、备份等）由外部 cron 处理，不放入 Gateway

---

## 3. 组件定义

### 3.1 OpenCode TUI

- **本质**: OpenCode 自带的交互式命令行界面
- **启动**: `opencode`（无参数）
- **MAFW 插件**: 通过 `opencode.json` 中 `plugin` 数组加载，OpenCode 自动解析 npm 包
- **生命周期**: 用户开就开，关就关，不影响后台 Gateway 运行
- **向 Gateway 注册**: 插件加载时 POST `localhost:3000/register`，传递 `projectDir` + `mafwDir`

### 3.2 OpenCode Serve

- **本质**: OpenCode 的 headless HTTP 服务器
- **启动**: 由 Gateway 作为子进程启动，`opencode serve --port 4096`
- **MAFW 插件**: 通过 `opencode.json` 加载，通过 HTTP API 接收 prompt
- **生命周期**: 长期运行，多 session，多 directory
- **崩溃恢复**: Gateway 监控，自动重启

### 3.3 MAFW 插件

- **本质**: 标准 npm 包 `opencode-plugin-mafw`
- **安装**: `npm install -g opencode-plugin-mafw`（全局推荐）或 `npm install --save-dev`（本地）
- **配置**: **用户手动编辑 `opencode.json`**，在 `plugin` 数组中添加 `"opencode-plugin-mafw"`
- **OpenCode 加载**: OpenCode 读取 `opencode.json` → 解析 `plugin` 数组 → 从 `node_modules`（本地或全局）加载插件包 → 扫描 `.opencode/skills/` → 执行插件入口
- **行为**: 不检测环境，无条件加载所有 Skill，注册所有命令
- **核心代码**: 拆分为 `mafw-plan`, `mafw-execute`, `mafw-review` 三个独立 Skill Entry
- **状态更新**: 每个 Skill Entry 函数末尾显式调用 `updateState()`，不依赖 hook
- **Gateway 注册**: `activate()` 时自动探测 `localhost:3000`，向 Gateway 注册当前项目

### 3.4 Gateway

- **本质**: 独立 Node.js 常驻进程，系统级服务
- **启动**: `npx mafw-gateway start`（前台）或 `npx mafw-gateway daemon`（后台）
- **系统服务注册**: `npx mafw-gateway service-register`（自动适配平台）
- **配置**: `~/.config/mafw/config.json`
- **日志**: `~/.config/mafw/logs/gateway.log`
- **职责**:
  1. 启动并监控 OpenCode Serve 子进程
  2. 启动 HTTP API 接收插件注册和控制指令
  3. 维护已注册项目索引（内存 + 磁盘持久化）
  4. 轮询已注册项目的 `state/*.json` 读取 `nextAction`
  5. 监控活跃 Session 心跳
  6. 运行 Automation Engine
- **多项目**: 一个 Gateway 实例服务多个项目，通过 `projectDir` 区分

### 3.5 Automation Engine（Gateway 子模块）

- **本质**: Gateway 内部"发现引擎"，非独立进程
- **职责**: 读取规则 → 注册 Cron → 触发 Skill → 处理结果 → 排队
- **核心原则**: 不直接执行任何任务，通过注册 Skill 实现可扩展的发现机制

### 3.6 Triage Inbox

- **本质**: 文件系统队列（`triage/*.json`）
- **状态流转**: `PENDING_CONFIRMATION` → `CONFIRMED` → `REJECTED` / `EXPIRED`
- **用户交互**: TUI `/triage` 查看列表，`/triage-confirm {id}` 确认执行
- **超时处理**: 24 小时未确认自动标记 `EXPIRED`

---

## 4. Gateway 常驻模式

### 4.1 设计目标

参考 OpenClaw Gateway 架构：
- **安装即服务**: `npm install -g opencode-plugin-mafw` 后自动注册系统级常驻服务
- **集中管理**: 一个 Gateway 进程服务所有项目
- **CLI 统一入口**: `npx mafw-gateway <command>` 管理生命周期
- **崩溃自愈**: 进程退出后由系统服务管理器自动重启
- **手动配置**: `opencode.json` 由用户显式编辑，不自动写入

### 4.2 生命周期模型

```
安装阶段（一次）
    │
    ├── npm install -g opencode-plugin-mafw
    │       │
    │       ▼
    │   postinstall 脚本
    │       ├─ 检查平台（win32 / darwin / linux）
    │       ├─ 注册系统服务（计划任务 / launchd / systemd）
    │       └─ 启动 Gateway（daemon 模式）
    │
    └── 或本地安装（每个项目）
            npm install --save-dev opencode-plugin-mafw
            # 不自动注册系统服务，仅安装代码
            # 用户手动编辑 opencode.json

运行阶段（持续）
    │
    ├── Gateway 作为系统服务常驻后台
    │       ├─ 开机自启
    │       ├─ 崩溃自动重启（指数退避）
    │       └─ 监听 localhost:3000
    │
    ├── 项目 A 打开 TUI
    │       │
    │       ▼
    │   插件 activate() → POST localhost:3000/register
    │       ├─ projectDir: D:/Projects/myapp
    │       └─ mafwDir: D:/Projects/myapp/.opencode/mafw
    │
    ├── 项目 B 打开 TUI
    │       │
    │       ▼
    │   插件 activate() → POST localhost:3000/register
    │       ├─ projectDir: D:/Projects/viz
    │       └─ mafwDir: D:/Projects/viz/.opencode/mafw
    │
    └── Gateway 同时轮询两个项目的 state/

卸载阶段
    │
    ├── npm uninstall -g opencode-plugin-mafw
    │       │
    │       ▼
    │   preuninstall 脚本
    │       ├─ 停止 Gateway
    │       └─ 注销系统服务
    │
    └── 或本地卸载
            npm uninstall opencode-plugin-mafw
            # 不注销系统服务（可能其他项目在用）
            # 手动从 opencode.json 的 plugin 数组中移除 "opencode-plugin-mafw"
```

### 4.3 跨平台服务注册

| 平台 | 机制 | 注册命令 | 用户感知 |
|------|------|---------|---------|
| **Windows** | 计划任务（Task Scheduler） | `Register-ScheduledTask` | 无需管理员（用户级任务） |
| **macOS** | launchd | `launchctl load` | 用户级 agent |
| **Linux** | systemd --user | `systemctl --user enable` | 用户级服务 |

### 4.4 Gateway CLI

```bash
# 前台启动（调试）
npx mafw-gateway start

# 后台守护模式（系统服务调用）
npx mafw-gateway daemon

# 停止
npx mafw-gateway stop

# 状态
npx mafw-gateway status

# 重启
npx mafw-gateway restart

# 查看日志
npx mafw-gateway logs

# 注册为系统服务（开机自启）
npx mafw-gateway service-register

# 注销系统服务
npx mafw-gateway service-unregister

# 查看/编辑配置
npx mafw-gateway config
```

### 4.5 端口与发现

- **默认端口**: 3000
- **冲突处理**: 若 3000 被占，自动探测 3001-3010
- **插件发现**: `activate()` 时轮询 `localhost:3000-3010/health`，找到可用 Gateway
- **配置持久化**: 实际端口写入 `~/.config/mafw/config.json`

---

## 5. 安装与部署

### 5.1 全局安装（推荐，多项目复用）

```powershell
# 1. 全局安装（自动注册系统服务 + 启动 Gateway）
npm install -g opencode-plugin-mafw

# 2. 验证 Gateway 状态
npx mafw-gateway status

# 3. 手动编辑 opencode.json，添加 "opencode-plugin-mafw"
#    文件位置: C:/Users/<用户名>/.opencode/opencode.json
#    或项目目录下的 opencode.json

# 4. 启动 TUI（Gateway 已在后台运行）
opencode

# 5. 直接使用
/goal 设计登录系统
```

### 5.2 本地安装（单项目，不注册系统服务）

```powershell
cd D:/Projects/myapp

# 1. 安装
npm install --save-dev opencode-plugin-mafw

# 2. 手动编辑项目根目录的 opencode.json
#    在 plugin 数组中添加 "opencode-plugin-mafw"

# 3. 手动启动 Gateway（前台）
npx mafw-gateway start

# 或注册系统服务
npx mafw-gateway service-register

# 4. 启动 TUI
opencode
```

### 5.3 opencode.json 配置（用户手动编辑）

**正确格式**（OpenCode 标准）：

```json
{
  "plugin": [
    "superpowers@latest",
    "opencode-plugin-openspec",
    "opencode-plugin-mafw"
  ]
}
```

**配置说明**:
- `plugin` 是字符串数组，每个元素是 npm 包名
- 可带版本号（如 `superpowers@latest`）
- OpenCode 自动从 `node_modules`（本地或全局）解析插件包
- 插件包内的 `package.json` 中 `opencode.plugin` 字段定义入口
- OpenCode 自动扫描插件包内的 `.opencode/skills/` 目录加载 Skills
- **用户完全掌控**: 可自由调整顺序、注释、与其他插件共存

### 5.4 安装后提示（postinstall）

```powershell
npm install -g opencode-plugin-mafw

# 输出：
# ╔════════════════════════════════════════════════════════════╗
# ║  opencode-plugin-mafw 已安装                               ║
# ╚════════════════════════════════════════════════════════════╝
#
# 下一步：
#   1. 编辑 opencode.json，在 plugin 数组中添加 "opencode-plugin-mafw"
#      示例：
#      {
#        "plugin": [
#          "superpowers@latest",
#          "opencode-plugin-mafw"
#        ]
#      }
#
#   2. 启动 Gateway:
#      npx mafw-gateway start
#      或注册系统服务: npx mafw-gateway service-register
#
#   3. 启动 OpenCode: opencode
#
#   4. 提交 Goal: /goal 设计登录系统
```

### 5.5 离线安装（无网络环境）

```powershell
# 开发机
npm pack
# → opencode-plugin-mafw-3.5.0.tgz

# 目标机器
npm install -g opencode-plugin-mafw-3.5.0.tgz
npx mafw-gateway service-register

# 手动编辑 opencode.json 添加 "opencode-plugin-mafw"
```

### 5.6 卸载

```powershell
# 全局卸载（自动注销系统服务）
npm uninstall -g opencode-plugin-mafw

# 手动从 opencode.json 的 plugin 数组中移除 "opencode-plugin-mafw"

# 本地卸载（保留系统服务，可能其他项目在用）
npm uninstall opencode-plugin-mafw
# 手动从 opencode.json 的 plugin 数组中移除 "opencode-plugin-mafw"
```

### 5.7 postinstall 行为（只提示，不修改）

```javascript
// scripts/postinstall.js

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  opencode-plugin-mafw 已安装                               ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('下一步：');
console.log('  1. 编辑 opencode.json，在 plugin 数组中添加 "opencode-plugin-mafw"');
console.log('     示例：');
console.log('     {');
console.log('       "plugin": [');
console.log('         "superpowers@latest",');
console.log('         "opencode-plugin-mafw"');
console.log('       ]');
console.log('     }');
console.log('');
console.log('  2. 启动 Gateway:');
console.log('     npx mafw-gateway start');
console.log('     或注册系统服务: npx mafw-gateway service-register');
console.log('');
console.log('  3. 启动 OpenCode: opencode');
console.log('');
console.log('  4. 提交 Goal: /goal 设计登录系统');
```

---

## 6. 数据流

### 6.1 完整数据流（跨 Session）

```
用户打开 OpenCode TUI
    │
    ▼
OpenCode 读取 opencode.json
    ├─ 解析 plugin 数组
    ├─ 发现 "opencode-plugin-mafw"
    ├─ 从 node_modules 加载插件包
    ├─ 扫描 .opencode/skills/ 目录
    └─ 执行插件入口
    │
    ▼
MAFW 插件 activate()
    ├─ 加载所有 Skill
    ├─ 注册所有命令
    ├─ 注册 hooks（异常兜底）
    └─ 向 Gateway 注册项目
        POST localhost:3000/register
        {
          "projectDir": "D:/Projects/myapp",
          "mafwDir": "D:/Projects/myapp/.opencode/mafw"
        }
    │
    ▼
Gateway 收到注册
    ├─ 写入内存表: registeredProjects["D:/Projects/myapp"] = { mafwDir: "..." }
    ├─ 持久化到磁盘: ~/.config/mafw/config.json
    └─ 返回 { status: "ok" }
    │
    ▼
用户输入: /goal 设计登录系统
    │
    ▼
MAFW 插件调用 mafw-goal Skill
    │
    ▼
Interview Agent 追问 (3-5 个问题)
    │
    ▼
用户回答 → Agent 生成 Goal Charter
    │
    ▼
用户说 "确认"
    │
    ▼
mafw-goal Skill 写入:
    ├─ goals/001-auth.md          (Goal Charter)
    ├─ requests/001-auth.json     (执行配置)
    ├─ STATUS.md                  (state: PENDING)
    └─ state/001-auth.json        (nextAction: CREATE_PLAN_SESSION, loop: 1)
    │
    ▼
TUI 显示: "Goal 已确认，后台即将启动"
TUI 可关闭
    │
    │ 文件系统 (磁盘记忆)
    ▼
Gateway (常驻进程) 轮询已注册项目
    ├─ 读取 ~/.config/mafw/config.json
    ├─ 遍历每个项目的 mafwDir/state/*.json
    │   ├─ 检查 mafwDir 是否存在（stale entry 清理）
    │   └─ 不存在则删除注册项并重写注册表
    └─ 发现 D:/Projects/myapp/.opencode/mafw/state/001-auth.json
    │
    ▼
Gateway 读取 state/001-auth.json
    ├─ nextAction: "CREATE_PLAN_SESSION"
    ├─ loop: 1
    └─ 读取 requests/001-auth.json 获取配置
    │
    ▼
Gateway: POST localhost:4096/session
    ├─ Header: X-OpenCode-Directory: D:/Projects/myapp
    └─ Body: {metadata: {mafw: true}}
    │
    ▼
OpenCode Serve 创建 Plan Session (directory=D:/Projects/myapp)
    │
    ▼
Gateway: POST /session/{id}/prompt_async
    └─ Body: {message: "/skill mafw-plan 001-auth"}
    │
    ▼
Plan Agent 执行（独立 Session）
    ├─ 读取 goals/001-auth.md (L1)
    ├─ 读取 lessons/ (L2 检索)
    ├─ 加载 parametric/ Δ (L3 注入)
    ├─ 拼接完整 Prompt
    ├─ 调用 LLM
    ├─ 解析回复为 waves.json
    ├─ 写入 tasks/{id}.md
    └─ 【显式】更新 state/001-auth.json:
        {
          "phase": "PLANNING_COMPLETE",
          "nextAction": "CREATE_EXECUTE_SESSION",
          "artifacts": { "plan": "waves.json" }
        }
    │
    ▼
Plan Session 正常结束
    ├─ 插件 hook 'session-ending' 触发（异常兜底）
    │   └─ 遍历 state 文件反查 sessionId → 检查 state 是否已更新 → 已更新，无操作
    └─ OpenCode 关闭 Session
    │
    ▼
Gateway 下一轮 poll 读取 state
    ├─ nextAction === CREATE_EXECUTE_SESSION
    ├─ 销毁 Plan Session (释放资源)
    └─ 创建 Execute Session
    │
    ▼
Execute Agent 执行（独立 Session，看不到 Plan 的上下文）
    ├─ 读取 waves.json
    ├─ Wave 1: Task 001-1, 001-2 并行执行
    ├─ 每个 Task: git checkout -b change/{task-id}
    ├─ 调用 LLM 编写代码
    ├─ 写入文件，git commit
    ├─ 合并 Wave 1 → goal/001-auth
    ├─ Wave 2: Task 001-3, 001-4 ...
    ├─ 远程 CLI 同步: remote-cli sync
    ├─ 远程 CLI 编译: remote-cli run "make test"
    ├─ 写入 receipts/001-auth/
    └─ 【显式】更新 state/001-auth.json:
        {
          "phase": "EXECUTING_COMPLETE",
          "nextAction": "CREATE_REVIEW_SESSION",
          "artifacts": { "execute": "receipts/001-auth/" }
        }
    │
    ▼
Execute Session 正常结束
    ├─ 插件 hook 'session-ending' 触发（异常兜底）
    └─ OpenCode 关闭 Session
    │
    ▼
Gateway 下一轮 poll 读取 state
    ├─ nextAction === CREATE_REVIEW_SESSION
    ├─ 销毁 Execute Session
    └─ 创建 Review Session
    │
    ▼
Review Agent 执行（独立 Session，看不到 Execute 的上下文）
    ├─ 读取 Goal Charter 指标
    ├─ 读取 receipts/001-auth/
    ├─ 读取 git diff
    ├─ 读取远程 CLI 测试结果
    ├─ 拼接 Review Prompt
    ├─ 调用 LLM 审查
    ├─ 返回 verdict: FAIL
    ├─ 原因: "覆盖率 60% < 80%"
    ├─ 写入 reviews/001-auth-loop1.md
    ├─ 写入 lessons/001-auth-loop1.md
    ├─ LessonCompactor 压缩为 YAML (L2)
    ├─ MemoryExtractor 提取 Δ (L3)
    └─ 【显式】更新 state/001-auth.json:
        {
          "phase": "REVIEWING_COMPLETE",
          "nextAction": "CHECK_VERDICT",
          "artifacts": { "review": "reviews/001-auth-loop1.md" },
          "metrics": { "test_coverage": 60, "lint_errors": 3 }
        }
    │
    ▼
Review Session 正常结束
    ├─ 插件 hook 'session-ending' 触发（异常兜底）
    └─ OpenCode 关闭 Session
    │
    ▼
Gateway 读取 state → nextAction: CHECK_VERDICT
    ├─ 读取 review 文件（只读，不解析业务逻辑）
    ├─ verdict !== PASS
    ├─ loop (1) < maxLoops (5)
    └─ 更新 state:
        {
          "nextAction": "CREATE_PLAN_SESSION",
          "loop": 2,
          "phase": "PLANNING",
          "sessions": {},
          "artifacts": {}
        }
    │
    ▼
Loop 2:
    │
    ├── Plan Agent（新 Session）
    │   ├─ 读取 goals/001-auth.md
    │   ├─ 读取 lessons/001-auth-loop1.md (Loop 1 经验)
    │   ├─ 加载 parametric/ Δ (覆盖率约束已注入)
    │   ├─ 拼接 Prompt (自动带上覆盖率检查清单)
    │   ├─ 调用 LLM
    │   └─ 解析 Plan (已包含边界测试)
    │   └─ 【显式】更新 state → nextAction: CREATE_EXECUTE_SESSION
    │
    ├── Execute Agent（新 Session）
    │   └─ Task 002-1, 002-2 ... (代码自动包含测试)
    │       ├─ 远程 CLI 同步
    │       └─ 远程 CLI 编译测试
    │   └─ 【显式】更新 state → nextAction: CREATE_REVIEW_SESSION
    │
    ├── Review Agent（新 Session）
    │   ├─ 调用 LLM 审查
    │   ├─ 读取远程测试结果
    │   ├─ 返回 verdict: PASS
    │   └─ 覆盖率: 85%
    │   └─ 【显式】更新 state → nextAction: CHECK_VERDICT
    │
    ├── Gateway 读取 verdict === PASS
    │   └─ 更新 state: { nextAction: "ARCHIVE" }
    │
    ▼
Archive（Gateway 或独立 Session）
    ├─ 合并 goal/001-auth → main
    ├─ L3 Validator 固化 Δ → AGENTS.md.runtime
    ├─ 生成报告 reports/001-auth.md
    └─ 更新 STATUS.md (state: COMPLETED)
    │
    ▼
Gateway 检测到 STATUS.md 状态变更
    │
    ▼
通知用户 (可选: 邮件/Slack/桌面通知)
```

---

## 7. 文件契约

### 7.1 请求文件（TUI 写入，Gateway 读取）

```json
// .opencode/mafw/requests/001-auth.json
{
  "version": "1",
  "goalId": "001-auth",
  "title": "用户认证系统",
  "state": "PENDING",
  "createdAt": "2026-06-23T12:00:00Z",
  "confirmedAt": "2026-06-23T12:05:00Z",
  "source": "tui",
  "projectDir": "D:/Projects/myapp",
  "mafwDir": "D:/Projects/myapp/.opencode/mafw",
  "goalCharter": "goals/001-auth.md",
  "metrics": {
    "test_coverage": { "target": 80, "unit": "%" },
    "lint_errors": { "target": 0, "unit": "count" }
  },
  "boundaries": [
    "必须使用 RS256 算法",
    "密码必须 bcrypt 加密",
    "不得修改现有用户表结构"
  ],
  "priority": "normal",
  "maxLoops": 5,
  "parallel": false,
  "degradeOnLoop": 5,
  "remoteCli": {
    "host": "192.168.1.100",
    "projectDir": "/opt/myapp",
    "syncOnExecute": true,
    "testCommand": "make test && make coverage"
  }
}
```

### 7.2 状态机文件（Skill Entry 显式写入，Gateway 读取）

```json
// .opencode/mafw/state/001-auth.json
{
  "version": "2",
  "goalId": "001-auth",
  "loop": 2,
  "phase": "REVIEWING",
  "lastPhase": "EXECUTING",
  "currentWave": 1,
  "totalWaves": 3,

  "sessions": {
    "plan": { "id": "sess_plan_abc", "createdAt": "...", "destroyedAt": "...", "active": false },
    "execute": { "id": "sess_exec_def", "createdAt": "...", "destroyedAt": "...", "active": false },
    "review": { "id": "sess_rev_ghi", "createdAt": "...", "active": true }
  },

  "nextAction": "CHECK_VERDICT",

  "artifacts": {
    "plan": "waves.json",
    "execute": "receipts/001-auth/",
    "review": "reviews/001-auth-loop2.md"
  },

  "metrics": {
    "test_coverage": 60,
    "lint_errors": 3
  },

  "updatedAt": "2026-06-23T15:00:00Z"
}
```

**nextAction 枚举**:
- `CREATE_PLAN_SESSION` → Gateway 创建 Plan Session
- `CREATE_EXECUTE_SESSION` → Gateway 创建 Execute Session
- `CREATE_REVIEW_SESSION` → Gateway 创建 Review Session
- `CHECK_VERDICT` → Gateway 读取 review，决定 ARCHIVE 或下一轮
- `ARCHIVE` → Gateway 触发 Archive 流程
- `COMPLETED` → Goal 结束
- `FAILED` → Goal 失败（maxLoops 耗尽或外部错误）
- `WAIT_PHASE_COMPLETE` → 等待 Skill Entry 更新 state 文件

### 7.3 状态文件（插件代码写入，Gateway 监控）

```yaml
# .opencode/mafw/STATUS.md
# 全局状态
lastUpdated: "2026-06-23T12:30:00Z"
activeGoals: 1
pendingGoals: 1

# Goal 列表
---
goalId: "001-auth"
state: "RUNNING"
loop: 2
phase: "REVIEWING"
wave: 1
task: "001-2-jwt-config"
progress: "45%"
lastHeartbeat: "2026-06-23T12:30:00Z"
sessionId: "sess_rev_ghi"
directory: "D:/Projects/myapp"

---
goalId: "002-viz"
state: "PENDING"
loop: 0
phase: null
lastHeartbeat: "2026-06-23T12:25:00Z"
sessionId: null
directory: "D:/Projects/viz"
```

### 7.4 Gateway 配置（全局）

```json
// ~/.config/mafw/config.json
{
  "version": "1",
  "gateway": {
    "port": 3000,
    "servePort": 4096,
    "host": "127.0.0.1",
    "logLevel": "info",
    "maxRestarts": 10,
    "restartDelay": 5000,
    "heartbeatTimeout": 300000,
    "pollInterval": 5000
  },
  "projects": {
    "D:/Projects/myapp": {
      "projectDir": "D:/Projects/myapp",
      "mafwDir": "D:/Projects/myapp/.opencode/mafw",
      "registeredAt": "2026-06-23T12:00:00Z",
      "lastSeen": "2026-06-23T12:30:00Z"
    },
    "D:/Projects/viz": {
      "projectDir": "D:/Projects/viz",
      "mafwDir": "D:/Projects/viz/.opencode/mafw",
      "registeredAt": "2026-06-23T12:30:00Z",
      "lastSeen": "2026-06-23T12:30:00Z"
    }
  },
  "automations": {
    "globalDir": "~/.config/mafw/automations",
    "enabled": true
  }
}
```

### 7.5 Automation 规则文件

```json
// .opencode/mafw/automations/daily-github.json
{
  "id": "daily-github",
  "enabled": true,
  "trigger": {
    "type": "cron",
    "schedule": "0 7 * * *",
    "timezone": "Asia/Shanghai"
  },
  "skill": "mafw-github-scanner",
  "args": {
    "repo": "my-org/myapp",
    "filters": ["open_prs", "pending_reviews", "ci_failed"]
  },
  "onResult": {
    "type": "triage",
    "template": "review pending PRs and fix CI failures",
    "auto_confirm": false
  },
  "goal_defaults": {
    "maxLoops": 3,
    "metrics": {
      "ci_pass": { "target": 100, "unit": "%" }
    }
  }
}
```

### 7.6 Triage Inbox 文件

```json
// .opencode/mafw/triage/20260624-070000-github.json
{
  "id": "triage-20260624-070000",
  "automationId": "daily-github",
  "discoveredAt": "2026-06-24T07:00:00Z",
  "source": "github",
  "summary": {
    "open_prs": 3,
    "ci_failed": 1,
    "pending_reviews": 2
  },
  "proposedGoal": {
    "title": "Review 3 PRs and fix 1 CI failure",
    "boundaries": ["不得合并 PR，仅审查"],
    "estimatedLoops": 2
  },
  "state": "PENDING_CONFIRMATION",
  "userAction": null,
  "deadline": "2026-06-24T12:00:00Z"
}
```

### 7.7 控制文件

```bash
# 用户暂停特定 Goal
echo '{"action":"PAUSE","goalId":"001-auth"}' > .opencode/mafw/control

# 用户终止特定 Goal
echo '{"action":"ABORT","goalId":"001-auth"}' > .opencode/mafw/control

# 用户强制进入下一阶段
echo '{"action":"FORCE_PHASE","goalId":"001-auth","targetPhase":"REVIEWING"}' > .opencode/mafw/control

# 用户重置 L3 缓存
echo '{"action":"RESET_PARAMETRIC"}' > .opencode/mafw/control
```

---

## 8. MAFW 插件

### 8.1 插件入口

```typescript
// src/plugin.ts — MAFW 插件入口
// 不检测环境，无条件加载所有能力

export class MafwPlugin {
  async activate(context: PluginContext) {
    // 1. 无条件加载所有 Skill
    await context.loadSkill('mafw-goal');
    await context.loadSkill('mafw-plan');
    await context.loadSkill('mafw-execute');
    await context.loadSkill('mafw-review');
    await context.loadSkill('mafw-memory-extractor');
    await context.loadSkill('mafw-compression-verifier');

    // 2. 无条件注册所有命令
    await this.registerCommands(context);

    // 3. 注册 hooks（异常兜底，非主路径）
    await this.registerHooks(context);

    // 4. 向 Gateway 注册项目（自动探测端口）
    await this.registerWithGateway();

    console.log('[MAFW] Plugin activated. All skills loaded. All commands registered.');
  }

  // ── 向 Gateway 注册项目 ──
  private async registerWithGateway(retries = 3) {
    const mafwDir = path.join(process.cwd(), '.opencode', 'mafw');
    const payload = {
      projectDir: process.cwd(),
      mafwDir,
      pluginVersion: '4.1',
      timestamp: new Date().toISOString()
    };

    // 探测 Gateway 端口（3000-3010）
    for (let port = 3000; port <= 3010; port++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (res.ok) {
          await fetch(`http://127.0.0.1:${port}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          console.log(`[MAFW] 已向 Gateway @ localhost:${port} 注册项目`);
          return;
        }
      } catch (e) {}
    }

    console.warn(`
[MAFW] ⚠️ Gateway 未运行
  请执行: npx mafw-gateway start
  或注册系统服务: npx mafw-gateway service-register
  Goal 提交将写入文件系统，Gateway 启动后自动接管。
`);
  }

  // 插件初始化时自动创建 MAFW 目录结构
  private async ensureMafwDirectories(mafwDir: string) {
    const dirs = [
      'state', 'requests', 'goals', 'waves', 'tasks',
      'lessons', 'handoffs', 'receipts', 'reviews', 'reports',
      'checkpoints', 'decisions', 'triage', 'automations',
      'parametric/prompt-deltas', 'parametric/constraint-deltas',
      'parametric/pattern-deltas', 'parametric/banned'
    ];
    for (const dir of dirs) {
      const fullPath = path.join(mafwDir, dir);
      if (!await fs.exists(fullPath)) {
        await fs.mkdir(fullPath, { recursive: true });
      }
    }
  }

  private async registerCommands(context: PluginContext) {
    context.registerCommand('/goal', async (args: string) => {
      const result = await context.runSkill('mafw-goal', { 
        text: args,
        projectDir: process.cwd()
      });

      if (result.confirmed) {
        await this.writeGoalRequest(result);
        return {
          type: 'goal_submitted',
          goalId: result.goalId,
          message: `✅ Goal "${result.title}" 已确认
` +
                   `📁 请求文件: requests/${result.goalId}.json
` +
                   `📊 状态文件: state/${result.goalId}.json
` +
                   `⏳ Gateway 将在后台自动调度...
` +
                   `
💡 提示: TUI 可以关闭，Goal 将在后台自动运行。`
        };
      }
    });

    context.registerCommand('/status', async () => {
      const status = await loadStatus();
      return formatStatusForTui(status);
    });

    context.registerCommand('/mafw-loop', async (args: string) => {
      const goalId = args.trim();
      return await context.runSkill('mafw-plan', { goalId });
    });

    context.registerCommand('/triage', async () => {
      const triageFiles = await glob('.opencode/mafw/triage/*.json');
      const pending = [];
      for (const file of triageFiles) {
        const item = JSON.parse(await fs.readFile(file, 'utf-8'));
        if (item.state === 'PENDING_CONFIRMATION') pending.push(item);
      }
      return {
        type: 'triage_list',
        items: pending,
        actions: ['confirm', 'ignore', 'edit']
      };
    });

    context.registerCommand('/triage-confirm', async (args: string) => {
      const triageId = args.trim();
      await fs.writeFile(
        '.opencode/mafw/control',
        JSON.stringify({ action: 'CONFIRM_TRIAGE', triageId })
      );
      return { type: 'triage_confirming', triageId };
    });

    context.registerCommand('/automation-add', async (args: string) => {
      const config = await context.runSkill('mafw-automation-interview', { text: args });
      if (config.confirmed) {
        const autoId = config.id || `auto-${Date.now()}`;
        await fs.writeFile(
          `.opencode/mafw/automations/${autoId}.json`,
          JSON.stringify({
            id: autoId,
            enabled: true,
            trigger: config.trigger,
            action: config.action,
            generator: config.generator,
            goal_defaults: config.goal_defaults
          }, null, 2)
        );
        await fs.writeFile(
          '.opencode/mafw/control',
          JSON.stringify({ action: 'RELOAD_AUTOMATIONS' })
        );
        return {
          type: 'automation_added',
          autoId,
          message: `✅ Automation "${autoId}" 已创建
` +
                   `⏰ 触发: ${config.trigger.schedule}
` +
                   `📁 文件: automations/${autoId}.json`
        };
      }
    });

    context.registerCommand('/automation-list', async () => {
      const autoFiles = await glob('.opencode/mafw/automations/*.json');
      const rules = [];
      for (const file of autoFiles) {
        const rule = JSON.parse(await fs.readFile(file, 'utf-8'));
        rules.push({
          id: rule.id,
          enabled: rule.enabled,
          schedule: rule.trigger?.schedule,
          actionType: rule.action?.type
        });
      }
      return { type: 'automation_list', rules };
    });

    context.registerCommand('/automation-toggle', async (args: string) => {
      const [autoId, enabledStr] = args.trim().split(' ');
      const enabled = enabledStr === 'true';
      const filePath = `.opencode/mafw/automations/${autoId}.json`;
      const rule = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      rule.enabled = enabled;
      await fs.writeFile(filePath, JSON.stringify(rule, null, 2));
      await fs.writeFile(
        '.opencode/mafw/control',
        JSON.stringify({ action: 'RELOAD_AUTOMATIONS' })
      );
      return { type: 'automation_toggled', autoId, enabled };
    });
  }

  // ── Hooks：只做异常兜底 ──
  // OpenCode 的 registerHook 接收 { handler, config } 对象，不是直接传函数
  private async registerHooks(context: PluginContext) {
    // Hook 1: 工具输出过大时自动压缩
    context.registerHook('tool-executed', {
      config: { maxOutputLength: 1000 },
      handler: async (hookContext: HookContext) => {
        if (hookContext.output.length > 1000) {
          await sessionPruner.compressToolOutput(hookContext.toolName, hookContext.output);
        }
      }
    });

    // Hook 2: Session 结束时的异常兜底
    // 遍历所有 state 文件反查 sessionId，不假设 sessionId 格式包含 goalId
    context.registerHook('session-ending', {
      config: { fallbackAction: 'RECREATE_SESSION' },
      handler: async (hookContext: HookContext) => {
        const sessionId = hookContext.sessionId;
        const stateFiles = await glob('.opencode/mafw/state/*.json');
        let targetGoalId: string | null = null;
        let targetPhase: string | null = null;

        for (const file of stateFiles) {
          const state = JSON.parse(await fs.readFile(file, 'utf-8'));
          for (const [phase, session] of Object.entries(state.sessions)) {
            if (session.id === sessionId && session.active) {
              targetGoalId = state.goalId;
              targetPhase = phase;
              break;
            }
          }
          if (targetGoalId) break;
        }

        if (!targetGoalId) {
          console.warn(`[MAFW] session-ending: no active state found for ${sessionId}`);
          return;
        }

        const state = await loadState(targetGoalId);
        if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
          console.warn(
            `[MAFW] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`
          );
          await updateState(targetGoalId, {
            nextAction: `CREATE_${targetPhase!.toUpperCase()}_SESSION`,
            error: 'session_ended_without_state_update'
          });
        }
      }
    });
  }

  private async writeGoalRequest(result: InterviewResult) {
    const goalId = result.goalId;
    const mafwDir = path.join(process.cwd(), '.opencode', 'mafw');
    await this.ensureMafwDirectories(mafwDir);

    await fs.writeFile(`goals/${goalId}.md`, formatGoalCharter(result));
    await fs.writeFile(
      `.opencode/mafw/requests/${goalId}.json`,
      JSON.stringify({
        version: '1',
        goalId,
        title: result.title,
        state: 'PENDING',
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        source: 'tui',
        projectDir: process.cwd(),
        mafwDir,
        goalCharter: `goals/${goalId}.md`,
        metrics: result.metrics,
        boundaries: result.boundaries,
        priority: result.priority || 'normal',
        maxLoops: result.maxLoops || 5,
        parallel: result.parallel || false,
        remoteCli: result.remoteCli
      }, null, 2)
    );

    await fs.writeFile(
      `.opencode/mafw/state/${goalId}.json`,
      JSON.stringify({
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
      }, null, 2)
    );

    await appendStatus({
      goalId,
      state: 'PENDING',
      loop: 0,
      lastHeartbeat: new Date().toISOString()
    });
  }
}
```

### 8.2 插件注册（opencode.json）

**用户手动编辑**，OpenCode 标准格式：

```json
{
  "plugin": [
    "superpowers@latest",
    "opencode-plugin-openspec",
    "opencode-plugin-mafw"
  ]
}
```

---

## 9. Gateway 核心

### 9.1 设计原则

- **常驻系统服务**: 开机自启，崩溃自动恢复，独立于 TUI 生命周期
- **极简**: 只负责 Session 生命周期管理（create → send → monitor → destroy）
- **无状态业务判断**: 不读取 waves.json、不解析 review、不计算 loop 计数
- **文件驱动**: 只读取已注册项目的 `state/{goalId}.json` 的 `nextAction` 字段
- **注册表持久化**: 项目注册信息写入 `~/.config/mafw/config.json`
- **可恢复**: 崩溃重启后从 `state/` 文件 + 注册表恢复所有活跃 Goal
- **多项目**: 一个 Gateway 实例服务多个项目

### 9.2 主循环

```typescript
// gateway/src/index.ts

interface StateFile {
  goalId: string;
  loop: number;
  phase: string;
  nextAction: string;
  sessions: Record<string, SessionInfo>;
  updatedAt: string;
}

interface ProjectInfo {
  projectDir: string;
  mafwDir: string;
  registeredAt: string;
  lastSeen: string;
}

class MafwGateway {
  private serveProcess?: ChildProcess;
  private serveUrl = 'http://127.0.0.1:4096';
  private apiPort = 3000;
  private activeGoals = new Map<string, StateFile>();
  private registeredProjects = new Map<string, ProjectInfo>();
  private sessionMonitors = new Map<string, NodeJS.Timeout>();
  private configPath = path.join(os.homedir(), '.config', 'mafw', 'config.json');
  private configWriteQueue: Promise<void> = Promise.resolve();

  async start() {
    await this.startServe();
    await this.startApiServer();
    await this.recoverConfig();
    await this.recoverState();
    await this.loadAutomations();
    await this.startPolling();
  }

  // ── 1. Serve 管理 ──
  private async startServe() {
    this.serveProcess = spawn('opencode', [
      'serve', '--port', '4096', '--hostname', '127.0.0.1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    this.serveProcess.on('exit', () => {
      console.error('[Gateway] Serve crashed, restarting in 5s...');
      setTimeout(() => this.startServe(), 5000);
    });

    await this.waitForServeReady();
  }

  // ── 2. HTTP API ──
  private async startApiServer() {
    const app = express();

    app.post('/register', async (req, res) => {
      const { projectDir, mafwDir } = req.body;
      this.registeredProjects.set(projectDir, {
        projectDir,
        mafwDir,
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
      await this.persistConfig();
      res.json({ status: 'ok', registered: projectDir });
    });

    app.post('/control', async (req, res) => {
      await this.processControlAction(req.body);
      res.json({ status: 'ok' });
    });

    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        serveRunning: !!this.serveProcess && !this.serveProcess.killed,
        registeredProjects: Array.from(this.registeredProjects.keys()),
        activeGoals: Array.from(this.activeGoals.keys())
      });
    });

    app.listen(this.apiPort);
    console.log(`[Gateway] HTTP API @ localhost:${this.apiPort}`);
  }

  // ── 3. 配置持久化（写队列防并发） ──
  private async persistConfig() {
    this.configWriteQueue = this.configWriteQueue.then(async () => {
      const config = this.loadConfigFromDisk();
      config.projects = Object.fromEntries(this.registeredProjects);
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    });
    await this.configWriteQueue;
  }

  private async recoverConfig() {
    if (await fs.exists(this.configPath)) {
      const config = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
      this.registeredProjects = new Map(Object.entries(config.projects || {}));
      console.log(`[Gateway] Recovered ${this.registeredProjects.size} registered projects`);
    }
  }

  // ── 4. 轮询 ──
  private async startPolling() {
    while (true) {
      await this.processControlFile();
      await this.discoverNewGoals();
      await this.advanceStateMachines();
      await this.checkHeartbeats();
      await sleep(5000);
    }
  }

  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      if (!await fs.exists(info.mafwDir)) {
        console.warn(`[Gateway] Project ${projectDir} no longer exists, removing`);
        this.registeredProjects.delete(projectDir);
        await this.persistConfig();
        continue;
      }

      const stateDir = path.join(info.mafwDir, 'state');
      if (!await fs.exists(stateDir)) continue;

      const stateFiles = await glob(`${stateDir}/*.json`);
      for (const file of stateFiles) {
        const state = JSON.parse(await fs.readFile(file, 'utf-8'));
        if (!this.activeGoals.has(state.goalId) && 
            state.nextAction !== 'COMPLETED' && 
            state.nextAction !== 'FAILED') {
          this.activeGoals.set(state.goalId, state);
          console.log(`[Gateway] Discovered new goal ${state.goalId} at ${state.phase}`);
        }
      }
    }
  }

  private async advanceStateMachines() {
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
          break;
        default:
          console.warn(`[Gateway] Unknown nextAction: ${nextAction} for ${goalId}`);
      }
    }
  }

  // ── 5. Phase Session 创建 ──
  private async createPhaseSession(
    goalId: string,
    phase: 'plan' | 'execute' | 'review',
    prompt: string
  ) {
    const req = await loadRequest(goalId);
    const existing = this.activeGoals.get(goalId)?.sessions?.[phase];
    if (existing?.active) {
      await this.destroySession(existing.id);
    }

    const session = await this.createSession(req.projectDir);
    await this.patchState(goalId, {
      sessions: {
        [phase]: { id: session.id, createdAt: new Date().toISOString(), active: true }
      },
      nextAction: 'WAIT_PHASE_COMPLETE'
    });

    await this.sendPrompt(session.id, `${prompt} ${goalId}`);
    this.startSessionMonitor(goalId, phase, session.id);
  }

  // ── 6. Verdict 处理 ──
  private async handleVerdict(goalId: string) {
    const state = this.activeGoals.get(goalId);
    if (!state) return;

    const req = await loadRequest(goalId);
    const reviewPath = state.artifacts?.review;
    if (!reviewPath) {
      await this.patchState(goalId, { nextAction: 'FAILED' });
      return;
    }

    const review = await loadReviewFile(reviewPath);
    if (review.verdict === 'PASS' && checkMetrics(req.metrics, review.metrics)) {
      await this.patchState(goalId, { nextAction: 'ARCHIVE' });
    } else {
      const currentLoop = state.loop;
      if (currentLoop >= req.maxLoops) {
        await this.patchState(goalId, { nextAction: 'ARCHIVE', forced: true });
      } else {
        await this.patchState(goalId, {
          loop: currentLoop + 1,
          phase: 'PLANNING',
          nextAction: 'CREATE_PLAN_SESSION',
          sessions: {},
          artifacts: {}
        });
      }
    }
  }

  // ── 7. Archive ──
  private async archiveGoal(goalId: string) {
    const req = await loadRequest(goalId);
    await this.mergeWorktree(goalId, req.projectDir);
    await this.generateReport(goalId);
    await this.updateStatus(goalId, { state: 'COMPLETED' });
    await this.patchState(goalId, { nextAction: 'COMPLETED' });
  }

  // ── 8. 心跳监控 ──
  private startSessionMonitor(goalId: string, phase: string, sessionId: string) {
    const key = `${goalId}:${phase}`;
    if (this.sessionMonitors.has(key)) {
      clearTimeout(this.sessionMonitors.get(key)!);
    }
    const timeout = setTimeout(async () => {
      console.error(`[Gateway] ${goalId} ${phase} session timeout, recreating...`);
      await this.destroySession(sessionId);
      await this.patchState(goalId, {
        nextAction: `CREATE_${phase.toUpperCase()}_SESSION`,
        error: 'heartbeat_timeout'
      });
    }, 5 * 60 * 1000);
    this.sessionMonitors.set(key, timeout);
  }

  private async checkHeartbeats() {
    for (const [goalId, state] of this.activeGoals) {
      const lastUpdate = new Date(state.updatedAt).getTime();
      if (Date.now() - lastUpdate > 5 * 60 * 1000) {
        const currentPhase = state.phase;
        await this.patchState(goalId, {
          nextAction: `CREATE_${currentPhase.toUpperCase()}_SESSION`,
          error: 'goal_heartbeat_timeout'
        });
      }
    }
  }

  // ── 9. 恢复 ──
  private async recoverState() {
    for (const [projectDir, info] of this.registeredProjects) {
      const stateDir = path.join(info.mafwDir, 'state');
      if (!await fs.exists(stateDir)) continue;
      const stateFiles = await glob(`${stateDir}/*.json`);
      for (const file of stateFiles) {
        const state = JSON.parse(await fs.readFile(file, 'utf-8'));
        if (state.nextAction !== 'COMPLETED' && state.nextAction !== 'FAILED') {
          this.activeGoals.set(state.goalId, state);
          console.log(`[Gateway] Recovered goal ${state.goalId} at ${state.phase}`);
        }
      }
    }
  }

  // ── 10. 控制文件处理 ──
  private async processControlFile() {
    for (const [projectDir, info] of this.registeredProjects) {
      const controlPath = path.join(info.mafwDir, 'control');
      if (!await fs.exists(controlPath)) continue;

      const control = JSON.parse(await fs.readFile(controlPath, 'utf-8'));
      switch (control.action) {
        case 'PAUSE':
          await this.patchState(control.goalId, { nextAction: 'PAUSED' });
          break;
        case 'ABORT':
          await this.destroyAllSessions(control.goalId);
          await this.patchState(control.goalId, { nextAction: 'FAILED' });
          break;
        case 'FORCE_PHASE':
          await this.destroyAllSessions(control.goalId);
          await this.patchState(control.goalId, {
            nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
          });
          break;
        case 'CONFIRM_TRIAGE':
          await this.confirmTriage(control.triageId, info.mafwDir);
          break;
        case 'RELOAD_AUTOMATIONS':
          await this.loadAutomations();
          break;
      }
      await fs.unlink(controlPath);
    }
  }

  // ── 工具函数 ──
  private async createSession(projectDir: string): Promise<Session> {
    const res = await fetch(`${this.serveUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { mafw: true }, directory: projectDir })
    });
    return res.json();
  }

  private async sendPrompt(sessionId: string, message: string) {
    await fetch(`${this.serveUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
  }

  private async destroySession(sessionId: string) {
    await fetch(`${this.serveUrl}/session/${sessionId}`, { method: 'DELETE' });
  }

  private async destroyAllSessions(goalId: string) {
    const state = this.activeGoals.get(goalId);
    if (!state) return;
    for (const [phase, session] of Object.entries(state.sessions)) {
      if (session.active) await this.destroySession(session.id);
    }
  }

  private async patchState(goalId: string, patch: Partial<StateFile>) {
    const statePath = `.opencode/mafw/state/${goalId}.json`;
    const current = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await fs.writeFile(statePath, JSON.stringify(updated, null, 2));
    this.activeGoals.set(goalId, updated);
  }
}
```

---

## 10. Ralph Loop 引擎（Phase 接力）

### 10.1 Plan Skill Entry（独立 Session）

```typescript
// src/skills/mafw-plan/entry.ts

export async function mafwPlanEntry(context: SkillContext) {
  const goalId = extractGoalId(context.message);
  const state = await loadState(goalId);

  const goal = await loadGoal(goalId);
  const lessons = await memoryIndex.loadRelevant(goalId);
  const deltas = await parametricStore.match({ agentType: 'plan', goalId });
  const handoff = state.loop > 1 ? await loadHandoff(goalId, state.loop - 1) : null;

  const prompt = buildPlanPrompt({ goal, lessons, deltas, handoff, loopNum: state.loop });
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  const plan = parsePlanResponse(response.content);
  await fs.writeFile('waves.json', JSON.stringify(plan.waves, null, 2));
  for (const task of plan.tasks) {
    await fs.writeFile(`tasks/${task.id}.md`, formatTask(task));
  }

  await updateState(goalId, { 
    phase: 'PLANNING_COMPLETE',
    nextAction: 'CREATE_EXECUTE_SESSION',
    totalWaves: plan.waves.length,
    artifacts: { plan: 'waves.json' }
  });
}
```

### 10.2 Execute Skill Entry（独立 Session）

```typescript
// src/skills/mafw-execute/entry.ts

export async function mafwExecuteEntry(context: SkillContext) {
  const goalId = extractGoalId(context.message);
  const req = await loadRequest(goalId);
  const worktree = await goalWorktreeManager.get(goalId);
  const waves = await loadWaves(goalId);

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    const results = await Promise.all(
      wave.tasks.map(async (task) => {
        const branch = await taskBranchManager.create(worktree.dir, task.id);
        const taskPrompt = buildTaskPrompt(task, worktree.dir);
        const response = await context.llm.chat({
          model: context.config.model,
          messages: [{ role: 'user', content: taskPrompt }]
        });
        await writeTaskCode(task, response.content, worktree.dir);
        await gitCommit(worktree.dir, `task: ${task.id}`);
        return { taskId: task.id, branch, status: 'done' };
      })
    );
    await mergeWaveToGoal(wave, worktree.dir);
    await updateState(goalId, { currentWave: i + 1 });
  }

  if (req.remoteCli?.syncOnExecute) {
    await remoteCli.sync({
      localDir: worktree.dir,
      remoteHost: req.remoteCli.host,
      remoteDir: req.remoteCli.projectDir
    });
  }

  await writeReceipts(goalId, worktree.dir);

  await updateState(goalId, { 
    phase: 'EXECUTING_COMPLETE',
    nextAction: 'CREATE_REVIEW_SESSION',
    artifacts: { execute: `receipts/${goalId}/` }
  });
}
```

### 10.3 Review Skill Entry（独立 Session）

```typescript
// src/skills/mafw-review/entry.ts

export async function mafwReviewEntry(context: SkillContext) {
  const goalId = extractGoalId(context.message);
  const req = await loadRequest(goalId);
  const state = await loadState(goalId);

  const receipts = await loadReceipts(goalId);
  const diff = await gitDiffGoal(goalId);

  let remoteResults = null;
  if (req.remoteCli?.testCommand) {
    remoteResults = await remoteCli.run({
      host: req.remoteCli.host,
      command: req.remoteCli.testCommand,
      cwd: req.remoteCli.projectDir
    });
  }

  const prompt = buildReviewPrompt({ receipts, diff, metrics: req.metrics, boundaries: req.boundaries, remoteResults });
  const response = await context.llm.chat({
    model: context.config.model,
    messages: [{ role: 'user', content: prompt }]
  });

  const review = parseReviewResponse(response.content);
  const reviewPath = `reviews/${goalId}-loop${state.loop}.md`;
  await fs.writeFile(reviewPath, formatReview(review));

  if (review.verdict === 'FAIL') {
    await writeLesson(goalId, state.loop, review);
    await lessonCompactor.compact(goalId, state.loop);
    await memoryExtractor.extract(goalId, state.loop);
  }

  await updateState(goalId, { 
    phase: 'REVIEWING_COMPLETE',
    nextAction: 'CHECK_VERDICT',
    artifacts: { review: reviewPath },
    metrics: review.metrics
  });
}
```

---

## 11. 状态更新机制

### 11.1 主路径：Skill Entry 显式写 state

```
Skill Entry 函数执行顺序:
  1. 读取输入（Goal / Waves / Receipts）
  2. 业务逻辑（LLM 调用 / 代码生成 / 审查）
  3. 写入产出（waves.json / receipts/ / reviews/）
  4. 【显式】updateState() → 写入 state.json
  5. 函数返回 → Session 关闭
```

**为什么不用 hook 做主路径？**
- Hook 执行时机不确定
- Hook 拿不到 Skill Entry 内部的局部变量
- Hook 失败时主路径已返回，没有重试机会
- 状态更新是业务核心，不是横切关注点

**Hook 注册格式（OpenCode 要求）**:
```typescript
// 正确：传入对象 { handler, config }
context.registerHook('session-ending', {
  config: { fallbackAction: 'RECREATE_SESSION' },
  handler: async (hookContext) => { /* ... */ }
});

// 错误：直接传函数
context.registerHook('session-ending', async (hookContext) => { /* ... */ });
// → TypeError: undefined is not an object (evaluating 'hook.config')
```

### 11.2 兜底：Hook 异常恢复

**注意**: OpenCode 的 `registerHook` 接收 `{ handler, config }` 对象，不是直接传函数。

```typescript
// src/hooks/session-ending.ts
// 导出为对象格式，供 plugin.ts 注册时使用

export const sessionEndingHook = {
  config: { fallbackAction: 'RECREATE_SESSION' },
  handler: async (hookContext: HookContext) => {
    const sessionId = hookContext.sessionId;
    const stateFiles = await glob('.opencode/mafw/state/*.json');
    let targetGoalId: string | null = null;
    let targetPhase: string | null = null;

    for (const file of stateFiles) {
      const state = JSON.parse(await fs.readFile(file, 'utf-8'));
      for (const [phase, session] of Object.entries(state.sessions)) {
        if (session.id === sessionId && session.active) {
          targetGoalId = state.goalId;
          targetPhase = phase;
          break;
        }
      }
      if (targetGoalId) break;
    }

    if (!targetGoalId) {
      console.warn(`[MAFW] session-ending: no active state found for ${sessionId}`);
      return;
    }

    const state = await loadState(targetGoalId);
    if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
      console.warn(
        `[MAFW] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`
      );
      await updateState(targetGoalId, {
        nextAction: `CREATE_${targetPhase!.toUpperCase()}_SESSION`,
        error: 'session_ended_without_state_update'
      });
    }
  }
};
```

### 11.3 状态更新工具函数

```typescript
// src/utils/state.ts

export async function updateState(goalId: string, patch: Partial<StateFile>) {
  const statePath = `.opencode/mafw/state/${goalId}.json`;
  const current = JSON.parse(await fs.readFile(statePath, 'utf-8'));
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeFile(statePath, JSON.stringify(updated, null, 2));
  return updated;
}
```

---

## 12. Worktree 隔离

### 12.1 隔离规则

| 层级 | 隔离单位 | 隔离机制 | 共享内容 |
|------|---------|---------|---------|
| **项目** | 项目目录 | 物理目录 | 无 |
| **Goal** | Goal | **Git Worktree** | 编译缓存、node_modules（可选） |
| **Wave** | Wave | 串行执行 | 同一 Worktree |
| **Task** | Task | **Git 分支** (`change/{task-id}`) | 同一 Worktree 文件系统 |

### 12.2 Goal Worktree 管理

```typescript
// src/engine/goal-worktree-manager.ts

export class GoalWorktreeManager {
  async prepare(config: { projectDir: string; goalId: string; parallel: boolean }): Promise<WorktreeInfo> {
    const { projectDir, goalId, parallel } = config;

    if (!parallel) {
      const branch = `goal/${goalId}`;
      await gitCheckout(branch);
      return { worktreeDir: projectDir, branch, isIsolated: false };
    }

    const worktreeDir = `${projectDir}-goal-${goalId}`;
    const branch = `goal/${goalId}`;
    await gitWorktreeAdd(worktreeDir, branch);
    return { worktreeDir, branch, isIsolated: true };
  }

  async archive(info: WorktreeInfo, strategy: 'merge' | 'squash' = 'merge') {
    await gitCheckout('main');
    if (strategy === 'merge') {
      await gitMerge(info.branch, { noFastForward: true });
    } else {
      await gitMergeSquash(info.branch);
    }
    if (info.isIsolated) {
      await gitWorktreeRemove(info.worktreeDir);
      await gitBranchDelete(info.branch);
    }
  }
}
```

### 12.3 Task 分支管理

```typescript
// src/engine/task-branch-manager.ts

export class TaskBranchManager {
  async createTaskBranch(worktreeDir: string, taskId: string, baseBranch: string): Promise<string> {
    const branch = `change/${taskId}`;
    await gitCheckout(baseBranch, { cwd: worktreeDir });
    await gitCheckoutBranch(branch, { cwd: worktreeDir });
    return branch;
  }

  async mergeTaskBranch(worktreeDir: string, taskId: string) {
    const branch = `change/${taskId}`;
    const goalBranch = await gitCurrentBranch({ cwd: worktreeDir });
    await gitCheckout(goalBranch, { cwd: worktreeDir });
    await gitMerge(branch, { cwd: worktreeDir });
    await gitBranchDelete(branch, { cwd: worktreeDir, force: false });
  }
}
```

---

## 13. 三层记忆与压缩

### 13.1 三层记忆

| 层级 | 记忆类型 | 存储位置 | 作用 | Token 预算 |
|------|---------|---------|------|-----------|
| **L1** | Working Context | Session + STATUS.md | 单次 Phase 内即时决策 | 2000-4000 |
| **L2** | Explicit Memory | `lessons/`, `handoffs/` | 跨 Loop 档案传递 | 1200 (3条) |
| **L3** | Parametric Memory | `parametric/` | 跨 Loop 行为改变 | 800 (5个Δ) |

### 13.2 三层压缩

| 层级 | 压缩类型 | 触发 | 机制 |
|------|---------|------|------|
| **L1** | Session Pruner | Session > 6000 tokens | 当前 Wave 保留，历史转 digest |
| **L2** | Lesson Compactor | 写入 lessons/ 时 | 自然语言 → YAML 结构化 (76% 压缩) |
| **L3** | Delta Injector | Agent 启动前 | 硬截断 5 个 Δ / 800 tokens |

### 13.3 Token 预算分配

```
总上下文窗口: 8000 tokens

System / Base Skill:        800 tokens (10%)
AGENTS.md.runtime:           200 tokens (2.5%)
Parametric Δ (L3):          800 tokens (10%) [硬截断 5 个]
Relevant Lessons (L2):     1200 tokens (15%) [最多 3 条]
Handoff:                    400 tokens (5%)
Current Wave (L1):         2000 tokens (25%) [完整保留]
Wave Digests (L1 压缩):    800 tokens (10%) [已完成 Wave 摘要]
Tool Output Buffer:        1300 tokens (16%) [动态，超则截断]
Reserve:                    500 tokens (6%) [突发请求]
```

---

## 14. 远程 CLI 集成

### 14.1 远程 CLI 作为 Connector

```typescript
// src/tools/remote-cli.ts

export class RemoteCliConnector {
  async sync(config: {
    localDir: string;
    remoteHost: string;
    remoteDir: string;
  }): Promise<{ success: boolean; output: string }> {
    const result = await execAsync(
      `remote-cli sync --project "${config.localDir}" --host ${config.remoteHost} --remote-dir "${config.remoteDir}"`
    );
    return { success: result.code === 0, output: result.stdout + result.stderr };
  }

  async run(config: {
    host: string;
    command: string;
    cwd: string;
  }): Promise<{ success: boolean; output: string; exitCode: number }> {
    const result = await execAsync(
      `remote-cli run --host ${config.host} --cwd "${config.cwd}" -- "${config.command}"`
    );
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
      exitCode: result.code
    };
  }
}
```

### 14.2 Execute 阶段集成

```typescript
if (req.remoteCli?.syncOnExecute) {
  const syncResult = await remoteCli.sync({
    localDir: worktree.dir,
    remoteHost: req.remoteCli.host,
    remoteDir: req.remoteCli.projectDir
  });
  if (!syncResult.success) {
    throw new Error(`Remote sync failed: ${syncResult.output}`);
  }
  await writeReceipts(goalId, worktree.dir, { phase: 'sync', result: syncResult });
}
```

### 14.3 Review 阶段集成

```typescript
if (req.remoteCli?.testCommand) {
  const testResult = await remoteCli.run({
    host: req.remoteCli.host,
    command: req.remoteCli.testCommand,
    cwd: req.remoteCli.projectDir
  });
  remoteResults = testResult;
  const prompt = buildReviewPrompt({ receipts, diff, metrics, boundaries, remoteResults });
}
```

---

## 15. 降级策略

| 级别 | 触发条件 | 策略 | 记忆保护 |
|------|---------|------|---------|
| **L1 警告** | Loop 3/5 | 提示用户选择 | 保留 Δ，标记 unverified |
| **L2 降级** | Loop 5/5 | 自动放宽指标 | 固化 energy > 0.7 的 Δ |
| **L3 熔断** | 连续 3 轮相同 Lesson | 强制退出，震荡 Δ 移入 banned/ | 写入熔断警告 |
| **L4 紧急** | Session 心跳超时 5min | 从断点恢复，重建当前 Phase Session | 恢复 L1 + L3 状态 |
| **L5 灾难** | 外部依赖失败（远程 CLI 断连） | 优雅失败，导出经验 | 导出 parametric/ + lessons/ |

---

## 16. Dashboard 看板

### 16.1 设计目标

STATUS.md 是 YAML 格式的机器可读文件，Dashboard 将其转换为**可视化 Kanban 看板**。

### 16.2 CLI 看板（终端内）

```bash
# TUI 内查看
/status --dashboard

# 或独立命令
npx mafw-dashboard
```

**效果**（ASCII 艺术）：

```
╔══════════════════════════════════════════════════════════════╗
║                    MAFW Dashboard                             ║
╠══════════════════════════════════════════════════════════════╣
║  ⏱  2026-06-24 10:30:00  │  📋 3 active  │  ✅ 5 done  │  ❌ 1 failed  ║
╚══════════════════════════════════════════════════════════════╝

  PENDING (1)          │  RUNNING (1)         │  COMPLETED (1)       │  FAILED (1)
  ──────────────────────────────────────────────────────────────────────────────────────
  ○ 002-viz     L0    │  ● 001-auth   L2     │  ● 003-api    L1     │  ● 004-cache  L5
    —           —      │    REVIEWING  45%    │    ARCHIVED   100%   │    REVIEWING  80%
  ──────────────────────────────────────────────────────────────────────────────────────

  提示: /status 刷新 │ /goal <id> 查看详情 │ Ctrl+C 退出
```

### 16.3 Web 看板（浏览器）

Gateway 内置轻量 HTTP 端点：

```bash
open http://localhost:3000/dashboard
```

**特性**：
- 深色主题 GitHub-style UI
- 拖拽卡片（手动调整 Goal 优先级）
- 点击卡片查看详情
- 实时 WebSocket 推送
- 响应式布局

### 16.4 与现有架构的关系

| 组件 | 职责 | 不碰 |
|------|------|------|
| **Dashboard** | 只读 STATUS.md，可视化展示 | 不修改任何状态文件 |
| **Gateway** | 提供 `/dashboard` HTTP 端点 | 不增加业务逻辑 |
| **TUI `/status`** | 调用 Dashboard CLI 渲染 | 不替代原有文本输出 |

---

## 17. 文件结构

```
opencode-plugin-mafw/                    # npm 包（源码仓库）
├── package.json                         # npm 入口
│   {
│     "name": "opencode-plugin-mafw",
│     "version": "4.1.0",
│     "description": "MAFW Loop Agent Plugin for OpenCode",
│     "main": "dist/plugin.js",
│     "opencode": {
│       "plugin": "dist/plugin.js"
│     },
│     "bin": {
│       "mafw-gateway": "./bin/mafw-gateway.js"
│     },
│     "scripts": {
│       "build": "tsc && cd gateway && npm run build",
│       "prepare": "npm run build"
│     },
│     "files": [
│       "dist/",
│       "gateway/dist/",
│       "gateway/package.json",
│       ".opencode/",
│       "bin/",
│       "README.md"
│     ]
│   }
├── bin/
│   ├── mafw-gateway.js                 # Gateway CLI（start/stop/status/daemon/service-register）
│   └── mafw-uninstall.js              # 项目级卸载
├── scripts/
│   ├── postinstall.js                  # npm install 后打印配置指引（绝不修改用户文件）
│   └── preuninstall.js                 # npm uninstall 前清理
├── src/
│   ├── plugin.ts                        # 插件入口
│   ├── skills/
│   │   ├── mafw-goal/entry.ts
│   │   ├── mafw-plan/entry.ts
│   │   ├── mafw-execute/entry.ts
│   │   ├── mafw-review/entry.ts
│   │   └── mafw-automation-interview/entry.ts
│   ├── tools/
│   │   ├── run-plan.ts
│   │   ├── run-execute-wave.ts
│   │   ├── run-review.ts
│   │   ├── write-lesson.ts
│   │   ├── archive-worktree.ts
│   │   └── remote-cli.ts
│   ├── engine/
│   │   ├── phase-orchestrator.ts
│   │   ├── wave-executor.ts
│   │   ├── goal-worktree-manager.ts
│   │   ├── task-branch-manager.ts
│   │   ├── lesson-manager.ts
│   │   ├── report-generator.ts
│   │   └── degradation.ts
│   ├── memory/
│   │   ├── extractor.ts
│   │   ├── store.ts
│   │   ├── injector.ts
│   │   ├── validator.ts
│   │   ├── matcher.ts
│   │   └── merger.ts
│   ├── compression/
│   │   ├── session-pruner.ts
│   │   ├── lesson-compactor.ts
│   │   ├── compression-verifier.ts
│   │   └── memory-index.ts
│   ├── hooks/
│   │   ├── tool-executed.ts
│   │   └── session-ending.ts
│   ├── utils/
│   │   ├── status.ts
│   │   ├── state.ts
│   │   ├── git.ts
│   │   └── github.ts
│   └── types/
│       ├── parametric.d.ts
│       ├── compression.d.ts
│       └── state.d.ts
├── gateway/                             # Gateway 核心（独立进程）
│   ├── src/
│   │   ├── index.ts                    # 主循环
│   │   ├── poll.ts                     # 轮询逻辑
│   │   ├── session-manager.ts          # Serve session 管理
│   │   ├── heartbeat.ts                # 心跳监控
│   │   ├── recovery.ts                 # 崩溃恢复
│   │   ├── automation-engine.ts        # 自动化引擎
│   │   └── ledger.ts                   # 审计日志
│   ├── package.json
│   ├── tsconfig.json
│   └── dist/                           # 编译产物
├── .opencode/
│   ├── plugins/
│   │   └── mafw-plugin.ts
│   └── skills/
│       ├── mafw-goal/SKILL.md
│       ├── mafw-plan/SKILL.md
│       ├── mafw-execute/SKILL.md
│       ├── mafw-review/SKILL.md
│       ├── mafw-automation-interview/SKILL.md
│       ├── mafw-github-scanner/SKILL.md
│       ├── mafw-cli-scanner/SKILL.md
│       ├── mafw-goal-generator/SKILL.md
│       ├── mafw-memory-extractor/SKILL.md
│       └── mafw-compression-verifier/SKILL.md
├── README.md
└── LICENSE

用户系统
├── ~/.config/mafw/
│   ├── config.json                     # Gateway 配置 + 项目索引
│   ├── gateway.pid                     # PID 文件
│   └── logs/
│       ├── gateway.log
│       └── gateway-error.log
├── （Windows 计划任务 / macOS launchd / Linux systemd）
│   MAFW-Gateway 服务
└── 项目 myapp/
    ├── package.json
    ├── opencode.json                   # ← 用户手动编辑
    │   {
    │     "plugin": [
    │       "superpowers@latest",
    │       "opencode-plugin-mafw"
    │     ]
    │   }
    ├── node_modules/
    │   └── opencode-plugin-mafw/
    └── .opencode/mafw/                 # 运行时生成
        ├── STATUS.md
        ├── state/
        ├── requests/
        ├── goals/
        ├── waves.json
        ├── tasks/
        ├── lessons/
        ├── handoffs/
        ├── receipts/
        ├── reviews/
        ├── reports/
        ├── checkpoints/
        ├── decisions/
        ├── triage/
        ├── automations/
        └── parametric/
```

---

## 18. 实施路径

### Phase 0: 架构重构 (1-2 天)

- [ ] 把 `mafw-loop/entry.ts` 拆分为 `mafw-plan`, `mafw-execute`, `mafw-review` 三个独立 Skill
- [ ] 新增 `state/` 目录和状态机文件格式
- [ ] 重写 Gateway 为极简状态机驱动（只读 `nextAction`，不碰业务逻辑）
- [ ] 实现 `updateState()` / `loadState()` 工具函数
- [ ] 验证: TUI 输入 `/goal`，触发 Interview，确认后自动创建目录结构并写入 `state/001-auth.json`

### Phase 1: Gateway 常驻模式 (2-3 天)

- [ ] 实现 Gateway 核心（HTTP API + 轮询 + Session 管理）
- [ ] 实现 `mafw-gateway` CLI（start/stop/status/daemon）
- [ ] 实现跨平台服务注册（Windows 计划任务 / macOS launchd / Linux systemd）
- [ ] 验证: `npm install -g` → 手动配 `opencode.json` → `opencode` → `/goal`

### Phase 2: Phase 接力 + 状态更新主路径 (2-3 天)

- [ ] 实现 `mafw-plan/entry.ts`（末尾显式 updateState）
- [ ] 实现 `mafw-execute/entry.ts`（末尾显式 updateState）
- [ ] 实现 `mafw-review/entry.ts`（末尾显式 updateState）
- [ ] 实现 `session-ending` hook（遍历 state 反查 sessionId）
- [ ] 验证: Gateway 发送一次 prompt，Phase 接力完成完整 Loop 到 Archive

### Phase 3: Worktree + Task 分支 (1-2 天)

- [ ] 实现 `goal-worktree-manager.ts`
- [ ] 实现 `task-branch-manager.ts`
- [ ] 验证: Wave 内 Task 并行，分支隔离，Wave 间串行合并

### Phase 4: 远程 CLI 集成 (1-2 天)

- [ ] 实现 `remote-cli.ts` Connector
- [ ] 在 `mafw-execute` 中集成 `remote-cli sync`
- [ ] 在 `mafw-review` 中集成 `remote-cli run`
- [ ] 验证: Execute 自动同步到远程，Review 自动读取远程编译/测试结果

### Phase 5: 三层记忆与压缩 (3-4 天)

- [ ] L1: Session Pruner
- [ ] L2: Lesson Compactor + Memory Index
- [ ] L3: Parametric Memory (Extractor + Store + Injector + Validator)
- [ ] 验证: 多 Loop 后 Δ 自动注入，行为改变

### Phase 6: 降级与运维 (1-2 天)

- [ ] 实现五级降级策略
- [ ] Gateway 日志轮转
- [ ] 运维命令 + Dashboard 看板
- [ ] 验证: Session 心跳超时自动重建，L3 熔断正确触发

### Phase 7: Automation Engine (2-3 天)

- [ ] 实现 `automation-engine.ts`（Cron 定时器 + action 分发）
- [ ] 实现 `automations/*.json` 规则解析
- [ ] 实现扫描器 Skills（github-scanner / cli-scanner / goal-generator）
- [ ] TUI 新增 `/automation-*` 命令
- [ ] 验证: 定时扫描 + Triage + 自动 Goal

---

## 19. Commit 规范

### 19.1 格式

```
<type>(<scope>): <description>

[optional body]
```

### 19.2 Type

| Type | 场景 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构 |
| `chore` | 工程杂项 |
| `docs` | 文档更新 |

### 19.3 Scope

| Scope | 说明 |
|-------|------|
| `gateway` | Gateway 进程相关 |
| `plugin` | MAFW 插件相关 |
| `connector` | 远程 CLI / GitHub 等 Connector |
| `memory` | 三层记忆与压缩 |
| `docs` | 文档 |

### 19.4 示例

```
feat(gateway): add system service registration for windows/macos/linux
feat(gateway): implement mafw-gateway CLI with start/stop/status/daemon
feat(plugin): auto-register project to gateway on activate
feat(gateway): add state machine driven session orchestration
fix(gateway): recover config and state on crash restart
```

---

*本文档基于 Ralph Loop 方法论、TMEM Parametric Memory 框架、动态上下文压缩工程编写。*
*核心理解: MAFW 是一个标准 npm 包。安装方式 `npm install -g opencode-plugin-mafw`。用户手动编辑 `opencode.json`，在 `plugin` 数组中添加 `"opencode-plugin-mafw"`。绝不自动修改 `opencode.json`。Gateway 是独立系统级常驻进程，通过 `mafw-gateway` CLI 管理。一个 Gateway 服务多个项目。所有 Agent 必须 Session 隔离。业务判断由插件 Skill Entry 显式写入 state.json，Gateway 只读。状态更新是主路径，写在 Skill Entry 函数末尾；Hook 只做异常兜底。远程 CLI 是唯一的 Connector。Worktree 按 Goal 隔离，Task 用 Git 分支隔离。Prompt 拼接由插件内部 tool 函数完成。Review 失败由插件代码判断，更新 state → Gateway 创建新 Loop。STATUS.md 心跳由插件代码更新，Gateway 监控。*
*核心原则: Agent 会忘，repo 不会；Agent 读了可能不做，Δ 让它不得不做。*
*安全原则: 不要完全失败，保留已有成果，提供手动接管路径。*
