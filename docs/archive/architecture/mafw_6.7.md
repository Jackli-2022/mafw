# MAFW v6.7 最终版架构

## 🏛️ 架构全景图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MAFW v6.7 Architecture                                  │
│           （种子记忆 + 每日增量同步 + Agent CRUD · 融入 Automation Engine）       │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  CodeAgent (OpenCode)                                                        │
  │  ┌───────────────────────────────────────────────────────────────────────┐  │
  │  │  Session + Skills (mafw-goal / mafw-plan / mafw-execute / mafw-review) │  │
  │  │  ★ mafw-seed (Seed Skill) ─── 新增技能                               │  │
  │  └───────────────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────┬─────────────────────────────────────────────┘
                                  │ hooks + MCP tools
                                  ▼
  ┌───────────────────────────────┴─────────────────────────────────────────────┐
  │  Plugin (src/) ──── 插件端（轻量，仅事件钩子）                              │
  │                                                                              │
  │  hooks/                                                                      │
  │  ├── handlers.ts ────── 5 hooks → fetch() 到 Gateway API                    │
  │  ├── messages-transform.ts ── 上下文注入（L3/L5/Harmonic）                  │
  │  └── seed-trigger.ts ──── ★ 首次检测 .mafw/ 缺失时触发 mafw-seed Skill      │
  └───────────────────────────────┬─────────────────────────────────────────────┘
                                  │ HTTP
  ┌───────────────────────────────┴─────────────────────────────────────────────┐
  │  Gateway (gateway/src/) ──── 网关端（核心逻辑）                              │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  ★ Seed Module (gateway/src/seed/)                                   │  │
  │  │                                                                       │  │
  │  │  index.ts ────────── 种子生成入口（被 Skill 调用）                    │  │
  │  │  seed-executor.ts ── 执行种子生成（协调扫描→分析→生成→写入）         │  │
  │  │                                                                       │  │
  │  │  scanners/                                                            │  │
  │  │  ├── package-scanner.ts   ← package.json / pyproject.toml            │  │
  │  │  ├── file-scanner.ts      ← 目录结构扫描                             │  │
  │  │  └── readme-scanner.ts    ← README 关键信息提取                      │  │
  │  │                                                                       │  │
  │  │  analyzers/                                                           │  │
  │  │  ├── tech-stack.ts        ← 技术栈识别 (语言/框架/数据库)            │  │
  │  │  ├── entry-points.ts      ← 入口文件识别                             │  │
  │  │  └── modules.ts           ← 模块识别 + 依赖关系                      │  │
  │  │                                                                       │  │
  │  │  generators/                                                          │  │
  │  │  ├── memory-generator.ts  ← LLM/规则双轨生成                         │  │
  │  │  └── seed-writer.ts       ← 写入 memories.json + 重建索引            │  │
  │  │                                                                       │  │
  │  │  sync/ ★ 增量同步                                                    │  │
  │  │  ├── git-detector.ts      ← Git 变化检测 (git diff --name-status)    │  │
  │  │  └── delta-merger.ts      ← 增量合并 (新增/修改/删除 → 记忆)        │  │
  │  │                                                                       │  │
  │  │  types.ts  ★ SeedContext / SeedResult / ChangeSet                    │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  Memory System (gateway/src/memory/)                                  │  │
  │  │                                                                       │  │
  │  │  harmonic-tier-store.ts ──────→ memories.json                        │  │
  │  │  tier1-store.ts ──────────────→ observations/{YYYY-MM-DD}.jsonl      │  │
  │  │  l5-store.ts ─────────────────→ ~/.mafw/l5/ (全局)                   │  │
  │  │  harmonic-index.ts ───────────→ .harmonic_index.json                 │  │
  │  │  cognitive-graph.ts ──────────→ .cognitive_graph.json                │  │
  │  │  abstraction-distiller.ts ────→ T2→T3, T4→L5Axiom                    │  │
  │  │  decay.ts ────────────────────→ 能量衰减 + 复习调度                   │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  ★ Automation Engine (gateway/src/automation-engine.ts)              │  │
  │  │  Cron 驱动的自动化任务调度器                                          │  │
  │  │                                                                       │  │
  │  │  ├── codehub-scan      │ 每 6 小时  │ CodeHub MR 扫描               │  │
  │  │  ├── triage-cleanup    │ 每日凌晨  │ Triage Inbox 清理              │  │
  │  │  └── memory-sync ★     │ 每日 2:00 │ Git diff → 增量记忆同步        │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  MCP Tools (:3001) — 13 个工具                                        │  │
  │  │                                                                       │  │
  │  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐ │  │
  │  │  │ mafw_search     │  │ mafw_write_     │  │ mafw_archive_memory ★ │ │  │
  │  │  │ (Read)          │  │ memory (Create/ │  │ (Delete/软删除)       │ │  │
  │  │  │                 │  │ Update/自动合并)│  │                       │ │  │
  │  │  └─────────────────┘  └─────────────────┘  └───────────────────────┘ │  │
  │  │                                                                       │  │
  │  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐ │  │
  │  │  │ mafw_restore_   │  │ mafw_update_    │  │ mafw_commit_          │ │  │
  │  │  │ memory ★        │  │ energy          │  │ heuristic             │ │  │
  │  │  │ (Undelete/恢复) │  │                 │  │                       │ │  │
  │  │  └─────────────────┘  └─────────────────┘  └───────────────────────┘ │  │
  │  │                                                                       │  │
  │  │  其余 7 个工具: mafw_observe, mafw_get_deltas, 等                    │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │                                                                              │
  │  ┌──────────────────────────────────────────────────────────────────────┐  │
  │  │  LangGraph Phase Relay                                                │  │
  │  │                                                                       │  │
  │  │  Phase 状态机:                                                       │  │
  │  │  IDLE → GOAL_SET → SEEDING ★ → PLANNING → PLANNED → EXECUTING →    │  │
  │  │  EXECUTED → REVIEWING → REVIEWED → COMPLETED                        │  │
  │  │                                                                       │  │
  │  │  SEEDING Phase: 首次进入时自动触发 mafw-seed Skill                   │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  Storage (.mafw/) ──── 项目级隔离                                          │
  │                                                                              │
  │  .mafw/                                                                     │
  │  ├── memories.json ──────────── HarmonicUnit 统一存储                      │
  │  ├── .seeded ────────────────── 种子生成标记                               │
  │  ├── .seed-last-commit ─────── ★ 上次同步的 commit hash                    │
  │  ├── memory/                                                               │
  │  │   ├── observations/ ──────── T1 原始观察（按天分片）                    │
  │  │   ├── .harmonic_index.json ─ 倒排索引                                  │
  │  │   └── .cognitive_graph.json ─ 认知图谱                                 │
  │  ├── parametric/project.yaml ── L3 Parametric Memory                     │
  │  ├── goals/, tasks/, lessons/  ─ 其他 MAFW 数据                          │
  │  ├── state/{goalId}.json ────── Phase 状态驱动                           │
  │  └── requests/ ──────────────── Request 文件                             │
  │                                                                              │
  │  ~/.mafw/                        ← 用户级全局目录                           │
  │  └── l5/                        ← L5 全局公理（所有项目共享）               │
  │      ├── axioms.json                                                       │
  │      └── heuristics.json                                                   │
  └─────────────────────────────────────────────────────────────────────────────┘
```


## 📦 核心组件清单

### 新增组件（v6.7）

| 组件 | 路径 | 职责 |
| :--- | :--- | :--- |
| `mafw-seed` Skill | `skills/mafw-seed/` | ★ 种子生成技能（Agent 可主动调用） |
| `seed-trigger.ts` | `plugin/hooks/` | 首次检测 `.mafw/` 缺失时触发 `mafw-seed` Skill |
| `seed-executor.ts` | `gateway/src/seed/` | 种子生成执行器（协调扫描→分析→生成→写入） |
| `package-scanner.ts` | `gateway/src/seed/scanners/` | 读取 package.json / pyproject.toml |
| `file-scanner.ts` | `gateway/src/seed/scanners/` | 扫描目录结构 |
| `readme-scanner.ts` | `gateway/src/seed/scanners/` | 提取 README 关键信息 |
| `tech-stack.ts` | `gateway/src/seed/analyzers/` | 识别技术栈（语言/框架/数据库） |
| `entry-points.ts` | `gateway/src/seed/analyzers/` | 识别入口文件 |
| `modules.ts` | `gateway/src/seed/analyzers/` | 识别模块列表 + 依赖关系 |
| `memory-generator.ts` | `gateway/src/seed/generators/` | LLM/规则双轨生成记忆 |
| `seed-writer.ts` | `gateway/src/seed/generators/` | 写入 memories.json + 重建索引 |
| `git-detector.ts` | `gateway/src/seed/sync/` | Git 变化检测（`git diff --name-status`） |
| `delta-merger.ts` | `gateway/src/seed/sync/` | 增量合并（新增/修改/删除 → 记忆） |
| `mafw-archive-memory.ts` | `gateway/src/tools/` | Agent 归档记忆（软删除） |
| `mafw-restore-memory.ts` | `gateway/src/tools/` | Agent 恢复归档记忆 |
| `seed-api.ts` | `gateway/src/api/` | REST API 端点（seed + sync） |
| `types.ts` | `gateway/src/seed/` | SeedContext / SeedResult / ChangeSet |

### 修改组件（v6.7）

| 组件 | 变更 |
| :--- | :--- |
| `HarmonicUnit` | 新增 `archived`、`archived_at`、`archive_reason` 字段 |
| `mafw_search` | 默认排除 `archived=true` 的记忆 |
| `automation-engine.ts` | 新增 `memory-sync` Cron 任务（每日凌晨 2:00） |
| `register-tools.ts` | 注册 `mafw_archive_memory`、`mafw_restore_memory` |
| `LangGraph Phase` | 新增 `SEEDING` Phase |
| `CodeAgent Skills` | 新增 `mafw-seed` Skill |


## 📦 更新后的 HarmonicUnit 数据模型

```typescript
interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  abstraction_level: number;  // 0=T1, 1=T2, 2=T3
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  salience: number;
  review_count: number;
  last_reviewed: string | null;
  top_associations: string[];
  distilled_from: string[];      // ★ 种子来源标记（如 ["auto-seed-llm-v1"]）
  // ★ v6.7 新增
  archived: boolean;
  archived_at: string | null;
  archive_reason: string | null;
  // 原有字段
  created_at: string;
  updated_at: string;
  merged_from: string[];
}
```


## 🔄 核心数据流

### 阶段一：种子初始化（首次）

```text
触发方式：
  ├── 首次检测 .mafw/ 缺失 → Plugin seed-trigger.ts → 触发 mafw-seed Skill
  ├── Agent 主动调用 mafw-seed Skill
  ├── CLI 命令：mafw seed
  └── REST API：POST /api/seed

执行流程（mafw-seed Skill）：
  1. 检查 .seeded 标记（force=true 可跳过）
  2. 扫描代码仓 → package.json / README.md / 目录结构 / 入口文件
  3. 规则分析 → 技术栈 / 模块 / 类 / 函数
  4. LLM 语义理解 → 模块职责 / 业务逻辑 / primary_abstraction
  5. 生成 6 个维度 → 10-20 条记忆（Energy=0.5）
  6. 标记 distilled_from = ["auto-seed-llm-v1"]
  7. 写入 memories.json + 重建索引
  8. 标记 .seeded + 写入 .seed-last-commit = HEAD
  9. 返回生成结果（数量/状态）
```

### 阶段二：每日增量同步（Automation Engine）

```text
调度：Cron '0 2 * * *'（每日凌晨 2:00）

执行流程：
  1. 读取 .seed-last-commit
  2. Git 变化检测：
     ├── git rev-parse HEAD → 当前 commit
     └── git diff --name-status {last} {HEAD}
  3. 无变化 → 更新 .seed-last-commit 时间戳，跳过
  4. 有变化 → 增量处理：
     ├── 新增文件 → 生成新记忆（Energy=0.5）
     ├── 修改文件 → 更新记忆（Energy += 0.1）
     └── 删除文件 → 降权（Energy -= 0.2）
  5. 增量合并（冲突检测：Agent 记忆优先，Energy > 0.5 时跳过）
  6. 写入存储 + 重建索引
  7. 更新 .seed-last-commit = HEAD
```

### 阶段三：Agent CRUD 操作（运行时）

```text
┌─────────────────┬──────────────────────────────┬──────────────────────────────────┐
│      操作       │          MCP Tool            │             行为                 │
├─────────────────┼──────────────────────────────┼──────────────────────────────────┤
│  Create（增）   │ mafw_write_memory            │ 写入新记忆（Energy=0.8）         │
│  Read（查）     │ mafw_search                  │ 检索（默认排除 archived=true）   │
│  Update（改）   │ mafw_write_memory            │ 自动合并（MinHash > 0.6）        │
│  Delete（删）   │ mafw_archive_memory ★       │ 软删除：Energy→0.3，archived=true│
│  Restore（恢复）│ mafw_restore_memory ★       │ 恢复归档：移除 archived 标记     │
└─────────────────┴──────────────────────────────┴──────────────────────────────────┘
```


## 🔌 API 端点

| 端点 | 方法 | 用途 |
| :--- | :--- | :--- |
| `/api/seed` | POST | 强制触发种子生成（由 Skill 调用） |
| `/api/seed/status` | GET | 查询种子状态（是否已生成、上次同步 commit） |
| `/api/seed/sync` | POST | 手动触发增量同步 |


## 🧠 Phase 更新

```typescript
// gateway/src/langgraph/types.ts
export type Phase =
  | "IDLE"
  | "GOAL_SET"
  | "SEEDING"      // ★ 新增：首次进入时自动触发 mafw-seed Skill
  | "PLANNING"
  | "PLANNED"
  | "EXECUTING"
  | "EXECUTED"
  | "REVIEWING"
  | "REVIEWED"
  | "COMPLETED";
```


## 📊 v6.6 → v6.7 变化对比

| 维度 | v6.6 | v6.7 |
| :--- | :--- | :--- |
| **种子生成** | ❌ 无 | ✅ Skill 化（`mafw-seed`），Agent 可主动调用 |
| **冷启动能力** | ❌ Agent 从零探索 | ✅ 开局即拥有 10-20 条项目知识 |
| **代码变化感知** | ❌ 无 | ✅ Git commit diff（`git diff --name-status`） |
| **记忆保鲜** | ❌ 记忆可能过时 | ✅ 每日增量同步，记忆自动更新 |
| **增量更新** | ❌ 无 | ✅ 仅处理变化部分，成本可控 |
| **冲突处理** | ❌ 无 | ✅ Agent 记忆优先（Energy > 0.5 跳过） |
| **Agent 删除能力** | ❌ 无 | ✅ `mafw_archive_memory` 软删除 |
| **Agent 恢复能力** | ❌ 无 | ✅ `mafw_restore_memory` 恢复 |
| **LLM 调用** | 可选（语义润色） | 推荐（种子生成 + 增量更新） |
| **Phase 数量** | 9 个 | 10 个（新增 SEEDING） |
| **调度方式** | — | Automation Engine（Cron '0 2 * * *'） |
| **新增存储** | — | `.seeded`、`.seed-last-commit` |
| **MCP 工具数** | 12 个 | **13 个**（+ `mafw_archive_memory`） |
| **Skills 数量** | 4 个（goal/plan/execute/review） | **5 个**（+ `mafw-seed`） |


## 🎯 设计原则（v6.7）

| 原则 | 说明 |
| :--- | :--- |
| **冷启动加速** | 新项目开局即拥有 10-20 条高质量记忆基座 |
| **Skill 化入口** | 种子生成作为 Skill（`mafw-seed`），Agent 可主动调用，与 goal/plan/execute/review 统一 |
| **LLM 优先，规则保底** | LLM 负责语义理解，规则负责提取显式信息 |
| **Git 驱动** | 利用 Git commit 作为天然快照，精确检测变化 |
| **增量更新** | 每日同步仅处理差异，成本可控 |
| **人工优先** | 自动生成的记忆不覆盖 Agent 写入的记忆（Energy > 0.5 跳过） |
| **完整 CRUD** | Agent 拥有对记忆的完整增、删、查、改能力 |
| **软删除优先** | 归档而非物理删除，保留历史追溯能力 |
| **统一调度** | 记忆同步作为 Automation Engine 的 Cron 任务，与其他自动化任务统一管理 |
| **自动与手动并存** | 系统自动同步 + Agent 主动管理，两者互补 |


## ✅ 一句话总结

**v6.7 让 MAFW 的记忆系统具备了完整的生命周期管理能力——首次进入项目时通过 `mafw-seed` Skill（LLM + 规则双轨）自动生成 10-20 条种子记忆，之后每日凌晨通过 Git diff 增量同步保持与代码仓一致，同时 Agent 通过 `mafw_search`（查）、`mafw_write_memory`（增/改）、`mafw_archive_memory`（删）拥有完整的 CRUD 控制权，形成了“系统自动维护 + Agent 自主管理”的双轨记忆治理模式。**