# MAFW v6.8 架构

## 变更清单（v6.7 → v6.8）

| # | 模块 | 变更 | 关联 PR |
|---|------|------|---------|
| 1 | Automation Engine | `cron` 库替换 stub，`scheduleRule` 真实 Cron 调度，`createGoal` 真实写入 | #1 |
| 2 | 记忆维护规则 | 4 条 Cron 规则：distill/decay/review/prune | #1 |
| 3 | 配置管理 | `gateway/src/config.ts` — YAML + env 覆盖三层优先级 | #2 |
| 4 | Goal 解耦 | 记忆/Hooks/Cost/Tools 不再强制依赖 goalId | #3 |
| 5 | 记忆融合 | `mafw_merge_memory` MCP 工具 + `/merge-memory` CLI | #4 |
| 6 | 存档自动融合 | `archive-worktree.ts` 调用 `mergeMemoryFromWorktree` | #5 |
| 7 | Git Worktree | `worktree-list`/`worktree-prune` CLI | #5 |
| 8 | 文件日志 | `installFileLogging` — `console.*` 自动写入 `.mafw/logs/mafw.log` | #6 |
| 9 | 搜索增强 | `mafw_search_hybrid` 接入 BM25 + RRF 融合 | #1 |
| 10 | 记忆注入 | `createAgentNode` 中注入 Parametric Delta | #1 |
| 11 | 桌面应用 | `mafw-desktop/` Electron + SolidJS 6 页面 | #7 |

## 架构全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MAFW v6.8 Architecture                            │
│    (Automation Engine + 记忆融合 + Git Worktree + 配置管理 + 桌面 )         │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  Plugin (src/) —— 插件端                                                  │
  │                                                                             │
  │  hooks/                                                                     │
  │  ├── session-start.ts     —— goalId 可选，无 goal 时照常运行               │
  │  ├── session-ending.ts    —— 记忆检测与 goal 解耦                          │
  │  ├── llm-after.ts         —— console.log → log 文件                        │
  │  └── ...                                                                   │
  │                                                                             │
  │  tools/                                                                    │
  │  ├── run-ask-user.ts      —— 路径扁平化：user-questions/{qid}.json          │
  │  └── run-record-feedback.ts —— 路径扁平化：user-feedback/{fid}.json        │
  │                                                                             │
  │  utils/                                                                    │
  │  ├── logger.ts            —— ★ 新增：installFileLogging()                 │
  │  └── git.ts               —— + listWorktrees / pruneWorktrees             │
  │                                                                             │
  │  MCP (src/mcp/tools.ts)                                                     │
  │  ├── mafw_search_hybrid  —— BM25 + RRF 融合                               │
  │  ├── mafw_merge_memory   —— ★ 新增：worktree 记忆融合                     │
  │  └── ...                                                                   │
  └───────────────────────────────┬─────────────────────────────────────────────┘
                                  │ HTTP
  ┌───────────────────────────────┴─────────────────────────────────────────────┐
  │  Gateway (gateway/src/) —— 网关端                                          │
  │                                                                             │
  │  config.ts                —— ★ 新增：统一配置管理 (YAML + env)             │
  │                                                                             │
  │  automation-engine.ts     —— ★ 增强：真实 Cron 调度 + action 分发          │
  │  ├── memory-distill       │ 每日 02:00 │ T2→T3 / T4→L5 蒸馏               │
  │  ├── memory-decay         │ 每日 03:00 │ 能量衰减                           │
  │  ├── memory-review        │ 每 6 小时  │ 复习队列更新                       │
  │  └── cognitive-prune      │ 每周日 04:00│ 图谱低权重边剪枝                  │
  │                                                                             │
  │  mcp/tool-registry.ts                                                     │
  │  ├── mafw_merge_memory —— ★ 新增                                          │
  │  └── ... (共 12 个工具)                                                    │
  │                                                                             │
  │  mcp/handlers/                                                             │
  │  ├── merge-memory.ts      —— ★ 新增：MinHash 比对 + 冲突处理              │
  │  └── ...                                                                   │
  │                                                                             │
  │  recovery.ts              —— .mafw 路径使用 MAFW_DIR 常量                  │
  │  index.ts                 —— 所有硬编码值改用 config.*                    │
  │  */*.ts                   —— 全部端口/URL/超时/路径集中管理                │
  └───────────────────────────────┬─────────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────┴─────────────────────────────────────────────┐
  │  Storage (.mafw/)                                                           │
  │                                                                             │
  │  .mafw/                                                                     │
  │  ├── config.yaml           —— ★ 项目级配置覆盖                              │
  │  ├── logs/                  —— ★ 插件日志 .mafw/logs/mafw.log              │
  │  ├── fusion-log.jsonl      —— ★ 记忆融合日志                               │
  │  ├── automations/                                                           │
  │  │   ├── memory-distill.json                                               │
  │  │   ├── memory-decay.json                                                 │
  │  │   ├── memory-review.json                                                │
  │  │   └── cognitive-prune.json                                              │
  │  ├── memory/                                                               │
  │  │   ├── memories.json                                                     │
  │  │   ├── .harmonic_index.json                                              │
  │  │   ├── .cognitive_graph.json                                             │
  │  │   └── .review_queue.json                                                │
  │  ├── user-questions/       —— 扁平化 {qid}.json                            │
  │  └── user-feedback/        —— 扁平化 {fid}.json                            │
  │                                                                             │
  │  ~/.config/mafw/config.yaml ← 全局配置覆盖                                 │
  └─────────────────────────────────────────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────┴─────────────────────────────────────────────┐
  │  Desktop 应用 (mafw-desktop/) —— ★ 新增                                    │
  │                                                                             │
  │  Electron + SolidJS + @opencode-ai/ui                                      │
  │                                                                             │
  │  ├── 主进程              │ Gateway Sidecar 管理 + IPC 桥接               │
  │  ├── 预加载              │ contextBridge → window.mafwAPI               │
  │  └── 渲染进程            │ SolidJS 6 Tab 页面                            │
  │      ├── Dashboard       │ Goal 看板 + KPI 卡片                          │
  │      ├── Memory          │ 记忆搜索 + 类型过滤                           │
  │      ├── Graph           │ SVG LangGraph 可视化 + SSE 实时               │
  │      ├── Chat            │ SSE 流式对话                                  │
  │      ├── Config          │ 配置编辑器                                    │
  │      └── Automations     │ 自动化规则管理                                │
  └─────────────────────────────────────────────────────────────────────────────┘
```

## 配置系统

三层优先级：`环境变量 > .mafw/config.yaml > ~/.config/mafw/config.yaml > 默认值`

```yaml
# .mafw/config.yaml —— 只写需要覆盖的字段
server:
  apiPort: 4000
  serveUrl: "http://127.0.0.1:4096"
loop:
  maxRounds: 5
search:
  defaultTopK: 50
```

环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔：
- `MAFW_SERVER_API_PORT=5000`
- `MAFW_LOOP_MAX_ROUNDS=7`
- `MAFW_CHAT_EXECUTE_GRAPH_KEYWORDS=go,run,start`

## 记忆融合（Merge-Memory）

```
mafw_merge_memory(sourceWorktree, resolveStrategy?)
         │
         ▼
1. 读取 source/.mafw/memory/memories.json
2. MinHash 比对 target 记忆
3. 对每条 source 记忆：
   ├── 相似度 > 60% + 内容相同 → 跳过
   ├── 相似度 > 60% + 内容不同 → 冲突 (按 strategy)
   └── 相似度 ≤ 60% → 新记忆, energy=0.4, merged_from=[srcId]
4. 写入 fusion-log.jsonl
```

存档时自动触发：`archive-worktree.ts` 在 git merge 前自动调用 `mergeMemoryFromWorktree()`，提取 worktree 独有记忆。

## 日志系统

`installFileLogging('.mafw/logs')` 在插件启动时劫持全局 `console.log/warn/error`：

```
console.log(...)
  ├─ 原样输出到控制台
  └─ 写入 .mafw/logs/mafw.log
      格式: [2026-07-14T10:30:00.000Z] [INFO] [hook:llm.after] Session sess-1: 42 chars
      轮转: 5MB → mafw.log.{timestamp}
```

## 桌面应用架构

```
Electron Main Process
  ├── BrowserWindow (SolidJS 页面)
  ├── IPC Handlers (gateway:start/stop/status)
  └── utilityProcess → fork MAFW Gateway

Preload (contextBridge)
  └── window.mafwAPI = { fetch, healthCheck, getPort, onGatewayStatus }

Renderer (SolidJS + @opencode-ai/ui)
  ├── Dashboard → Goal 看板 + KPI
  ├── Memory → 搜索 + 融合
  ├── Graph → SVG + dagre + SSE 实时
  ├── Chat → SSE 流式
  ├── Config → YAML 编辑器
  └── Automations → 规则管理
```

## 新增文件清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `gateway/src/config.ts` | 280 | 统一配置管理（YAML + env + 默认值） |
| `gateway/src/mcp/handlers/merge-memory.ts` | 130 | 记忆融合 MCP 处理程序 |
| `src/utils/logger.ts` | 48 | 文件日志拦截器 |
| `src/engine/goal-worktree-manager.ts` | +30 | listWorktrees / prune |
| `src/utils/git.ts` | +30 | listWorktrees / pruneWorktrees / hasLocalChanges / fetch / push |
| `mafw-desktop/package.json` | - | Electron + SolidJS 桌面应用 |
| `mafw-desktop/src/main/index.ts` | 55 | 主进程入口 |
| `mafw-desktop/src/main/sidecar.ts` | 55 | Gateway 子进程管理 |
| `mafw-desktop/src/main/ipc.ts` | 25 | IPC handler 注册 |
| `mafw-desktop/src/preload/index.ts` | 40 | contextBridge API |
| `mafw-desktop/src/renderer/index.tsx` | 100 | SolidJS 入口 + 6 Tab |
| `mafw-desktop/src/renderer/pages/*.tsx` | 6 files | Dashboard/Memory/Graph/Chat/Config/Automations |
| `mafw-desktop/src/renderer/hooks/*.ts` | 2 files | useGatewayAPI / useGatewaySSE |
| `.mafw/automations/*.json` | 4 files | 记忆维护 Cron 规则 |

## 修改文件清单（20+ 文件）

| 文件 | 改动 |
|------|------|
| `gateway/src/index.ts` | 全部硬编码值改用 `config.*` |
| `gateway/src/automation-engine.ts` | 真实 Cron 调度 + action 模式 + createGoal |
| `gateway/src/session-manager.ts` | URL/超时 → config |
| `gateway/src/recovery.ts` | `.mafw` 路径改用 MAFW_DIR 常量 |
| `gateway/src/*.ts` (18 files) | 端口/URL/超时/路径 → config |
| `src/plugin.ts` | 记忆注入不依赖 goalId；日志；merge-memory CLI；worktree CLI |
| `src/mcp/tools.ts` | BM25 + RRF 搜索；merge-memory handler |
| `src/langchain/node-runner.ts` | DeltaInjector 记忆注入 |
| `src/hooks/session-start.ts` | 无 goal 目录时不提前 return |
| `src/hooks/session-ending.ts` | 高能记忆检测与 goal 解耦 |
| `src/cost/cost-estimator.ts` | goalId 可选 |
| `src/cost/types.ts` | CostRecord.goalId 可选 |
| `src/tools/run-ask-user.ts` | 路径扁平化 |
| `src/tools/run-record-feedback.ts` | 路径扁平化 |
| `src/tools/archive-worktree.ts` | 存档时自动融合记忆 |
| `src/memory/harmonic-types.ts` | 加 `goal_id`、加 `'global'` 类型 |
| `src/memory/abstraction-distiller.ts` | 修 distillT4toL5 sourcelGoalIds bug |
| `src/memory/review-scheduler.ts` | tick() 改为 public |

## 测试

```
79 suites, 582 tests, 0 failures (v6.8)
新增测试: config.test.ts (9), merge-memory.test.ts (5)
```
