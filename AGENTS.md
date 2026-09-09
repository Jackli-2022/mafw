# MAFW Gateway & Plugin 架构

## 1. 谐波记忆系统

### 3.1 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';  // 字段名是 type（非 memory_type）
  primary_abstraction: string;    // 6-8 词核心摘要（实际各写路径放全文/摘要不等）
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // 参与排序（写路径计算并存 OKF，检索 ×energy×salience，缺失按 1）
  abstraction_level?: number;     // 0=T1, 1=T2, 2=T3/T4, 3=L5；写路径统一映射（episodic→1，semantic/procedural→2，global→3）
  review_count?: number;          // 休眠：类型声明，无写路径，复习队列无消费者
  last_reviewed?: string;         // 休眠：同上
  top_associations?: string[];    // 未实现：类型声明，全仓库零读写（联想预取不存在）
  merged_from?: string[];         // MinHash 合并来源 id（写路径 merge 时填充）
  superseded_by?: string;         // soft-supersede：指向取代本条的新 id（披露注入与检索排序排除）
  pinned?: boolean;               // 披露层：每轮注入 <user-profile>（superseded 后失效）；与 type 正交
  sticky_until?: string;          // 便签板：每轮注入 <note-board> 直到该 ISO 日期（板级过期，记忆本体保留；坏日期 fail-open 在板）
  created_at: string;
  updated_at: string;
}
```

> 存量合体清理：`cd gateway; npx ts-node scripts/unmerge-blobs.ts`（dry-run 默认，`--apply` 执行并自动备份；需先 `mafw stop`；索引 filePath 相对 `~/.mafw` 解析）

> 注：`goal_id` 为历史兼容字段，当前写路径不填充。
> MinHash 合并采用 **soft supersede**：相似旧条目标记 `superseded_by` 并降低 energy（×0.5），不物理删除，便于 knowledge-update 场景保留历史版本；检索排序时 superseded 条目再 ×0.5 惩罚。

### 3.2 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → 加载 .harmonic_index.json（无视 memory_type 与层级）
     → 按 energy × 检索得分排序
     → 按需从 tier 文件加载完整 memory_value
```
三种检索器（`gateway/src/core/memory/harmonic-index.ts`）：
- **bm25（默认）**：query 分词做 BM25（k1=1.2, b=0.75）× energy × salience，tokenize 为小写单词（len≥2）+ CJK unigram；查询时现算，不持久化索引文件
- **hybrid**：bm25 + dense embedding 经 RRF(k=60) 融合（`searchScored` 的 `denseScores` 选项；异步嵌入由调用方完成，searchScored 保持同步）；embedding 走 `memory.embedding` 配置（local ONNX Qwen3-Embedding-0.6B / dashscope compatible-mode，默认 off）
- **token**：子串计数 × energy × salience，可通过 `mafw_search_hybrid` 的 `retriever:'token'` 或 `/api/memory/search?retriever=token` 显式回退

**显式时间锚定**（`gateway/src/recall/time-anchor.ts`）：查询含时间表达（昨天/last week/N月/recent 等）时，created_at 落入对应窗口的条目 ×1.5 软提升（不硬过滤，E.4 陷阱）；`options.now` 供评测传 question_date。

LongMemEval 基准（session 粒度 R@10）：token 0.474 → **bm25 0.949**（6/6 类提升；1000 entries 搜索 ~2-3ms）。`searchScored()` 同时返回原始分数，供下游精排、截断与置信度展示使用。heuristic reranker 在 session 粒度经 realistic-energy 消融证实零增益（rerankWeights 全部信号在候选集内无区分度）。

Index scan 传输（`recall/index-scan.ts`）优先走 runtime 契约的 `completion.complete()`（`completionApi` 能力，thunk 现读热切换安全），缺能力/失败时回退直连 HTTP（`runtime/completion-http.ts` 共享实现，`cacheable` 块映射 DashScope `cache_control: ephemeral`）。

### 3.3 压缩

`HarmonicUnitFileStore.write()` 输出 `HarmonicUnit` 并自动：
1. 计算显著度
2. 写入对应 tier 文件（`concepts/{semantic|episodic|procedural|global|knowledge}/`）
3. 更新 `.harmonic_index.json`
4. 触发 MinHash 跨层合并检查（`MinHashMerger.merge()`，阈值 0.7、32 签名、3-gram shingle、FNV-1a 双哈希 Kirsch–Mitzenmacher；段级匹配——合体按 ` | ` 切段取 max sim 防稀释；合并不加 energy；`memory_value` 合并上限 2000 字符截断于段边界；合并产物带 `merged_from` 防递归；`skipMerge` 选项供 LongMemEval 基准等确定性摄入场景关闭）
5. 触发静态 `onMemoryWritten` 监听器（dense 嵌入索引 + LLM 合并裁判，见 §3.5）

> 注：`HybridCompressor`（会话压缩管线）只挂在 deprecated legacy 插件路径，当前 gateway 运行时写路径是 `/api/memory/add` + MCP handler + turnCompress worker，均经 `HarmonicUnitFileStore.write()`。

### 3.5 Dense 混合检索与语义合并（P1/P2，opt-in）

`memory.embedding.provider`（默认 `off`；`local` = ONNX Qwen3-Embedding-0.6B / `dashscope` = text-embedding-v4 compatible-mode）：

- **EmbeddingRuntime**（`gateway/src/memory/embedding-runtime.ts`）：进程单例（provider + `MemoryVectorStore` + `EmbeddingIndexer`）。向量文件 `~/.mafw/memory/vectors-<model>.json`（按 provider.name 打标签，GGUF 与 ONNX 嵌入不共享）；写路径 fire-and-forget 嵌入（2s 防抖批量 flush，失败丢弃不阻塞）
- **本地引擎双实现**（`memory.embedding.engine`）：`onnx`（transformers.js 进程内，`threads` 线程帽默认 2）/ `llamacpp`（`llamacpp-provider.ts`：llama-server sidecar 子进程，官方二进制自动下载含 ghfast.top 镜像回退，`gpu: cpu|vulkan|cuda` 变体切换、GPU 变体自动 `-ngl 99`）。**llama-server embedding 必备旗标**（踩坑实证）：`-fa on`（否则非因果注意力物化 L² 矩阵，ctx4096 时 RSS 3GB）、`-np 1 --no-warmup`（否则 np=auto 多槽 KV + warmup 全量缓冲 → 2.8GB）、`-cram 0`（prompt cache 对 embedding 任务只写不读涨到 8GB 上限，llama.cpp #26293）、`-c/-b/-ub ≥ 文本 token 上限`（超长输入 HTTP 400 被静默丢弃会拖垮 dense 通道，provider 有 400→截断重试兜底）
- **检索**：`computeDenseScores(query)` → `searchScored({denseScores})` → RRF 融合；`mafw_search_hybrid` 的 `retriever:'hybrid'` 与 `/api/memory/search?retriever=hybrid` 已接线；boundary recall 同步路径**不**嵌查询（100ms 契约）
- **ConsolidationService**（`gateway/src/memory/consolidation-service.ts`）：写入后 cosine≥0.8 候选召回 → worker 模型 LLM 判 UPDATE/CREATE（Memora 式）；UPDATE 合入新条目 + soft-supersede 旧条目 + 删除旧向量；裁判不可达时 skip（fail-open）；`GET /api/memory/stats` 暴露 update ratio（健康区间 ~16-22%）

### 3.4 能量衰减

- 基础衰减率 **0.005/天**（`EnergySystem.decayRatePerDay`，salience 越高衰减越慢——`HarmonicIndexEntry` 携带 `salience`，衰减 pass 读取）
- 默认自动化规则 `memory-decay`（每日 UTC 3:30，`recall/pipeline-rules.ts` 供给）：**增量衰减**——按 entry `last_decay_at`（缺失回退 `created_at`）计算流逝天数做纯时间衰减（无事件加成）；`last_decay_at` 仅在实际写入衰减时盖章（低于 0.005 写入阈值时天数继续累积，防低 salience 条目饥饿）
- index v1→v2 一次性迁移：全部 entry 盖 `last_decay_at`=迁移时刻、**不补扣历史衰减**（旧实现按 `created_at` 每次运行重复扣全龄衰减，累计 r·n(n+1)/2 平方损失，历史已过度衰减故豁免）；迁移由 `HarmonicIndexManager.migrateDecayBaseline()` 执行
- 事件加成（`retrieved` +0.02 / `useful_feedback` +0.1 等）由 `EnergySystem.calculateEnergy` 提供，属于检索/反馈路径的语义，**不在**衰减 pass 中混用
- 检索访问加成（search 时 +0.02）当前未接入检索路径（休眠）

## 4. Tools 清单（v6.9 总共 44 个）

### 4.1 Gateway MCP 工具（40 个，`gateway/src/mcp/tool-registry.ts`）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | 谐波记忆检索（BM25×energy×salience 默认；`retriever:'token'` 回退子串计数；支持迭代图扩展） |
| `mafw_get_deltas` | 获取参数化约束（L3） |
| `mafw_update_state` | 更新状态文件 |
| `mafw_load_state` | 读取状态文件 |
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |
| `mafw_add_memory` | 写入记忆单元（`supersedes` 显式取代旧条目；`pinned` 披露层；`sticky`/`stickyDays` 便签板；`cueAnchors` 多跳线索） |
| `mafw_get_memory` | 按 id 取记忆全文（支持 `<recall>` 指针尾 6 位；superseded 自动附 supersede 链最新版） |
| `mafw_supersede_memory` | 标记已有记忆为 superseded（不写新条目，仅降能+惩罚检索排序） |
| `mafw_pin_memory` | pin/unpin 披露层（`<user-profile>` 每轮注入）；`sticky`/`stickyDays` 上板/续期/下架便签板 |
| `mafw_commit_heuristic` | 提交 L5 启发式 |
| `mafw_get_axioms` | 获取 L5 公理 |
| `mafw_merge_memory` | ★ 跨 worktree 记忆融合 |
| `mafw_resolve_merge` | 解决记忆融合冲突 |
| `mafw_create_goal` | 创建 Goal（Manager 专用） |
| `mafw_set_goal` | 设置活跃 Goal |
| `mafw_get_goal_status` | 查询 Goal 状态 |
| `mafw_list_goals` | 列出 Goal |
| `mafw_answer_question` | 回答待决问题（Manager） |
| `mafw_get_evidence` | 获取 Goal 证据 |
| `mafw_cancel_goal` | 取消 Goal |
| `mafw_list_pending_questions` | 列出待决问题 |
| `mafw_list_automation_rules` | 列出自动化规则 |
| `mafw_get_automation_rule` | 查询自动化规则 |
| `mafw_get_automation_history` | 自动化历史 |
| `mafw_run_automation` | 手动运行自动化 |
| `mafw_validate_rule` | 校验规则 |
| `mafw_list_triage_items` | 列出 triage 项 |
| `mafw_get_triage_item` | 查询 triage 项 |
| `mafw_propose_triage_decision` | 提议 triage 决策 |
| `mafw_draft_automation_rule` | 起草自动化规则 |
| `mafw_desktop_screenshot` | 桌面截图 |
| `mafw_desktop_navigate` | 桌面导航 |
| `mafw_desktop_get_ui_state` | 桌面 UI 状态 |
| `mafw_desktop_click` | 桌面点击 |
| `mafw_desktop_type` | 桌面输入 |
| `mafw_desktop_scroll` | 桌面滚动 |
| `mafw_restart_agent` | 重启 gateway 拥有的 agent 进程（opencode serve sidecar）；external/进程内 runtime 不可用 |

> **接线要求（2026-09-08 修复）**：以上 39 个工具经 gateway legacy SSE MCP 暴露（`http://127.0.0.1:3000/mcp`），opencode 侧需在配置中有 `"mcp": { "mafw": { "type": "remote", "url": "http://127.0.0.1:3000/mcp", "enabled": true, "oauth": false } }` 才可用。接线有两条路径：①插件**激活时自接线**（`src/utils/self-wiring.ts` 的 `ensureMcpWiring()`——检测全局 `~/.config/opencode/opencode.jsonc` 缺 `"mcp"` 段则幂等补写，带 `.bak-mafw-<ts>` 备份，fail-open）；②手动写全局或项目级 opencode 配置。**排错关键**：旧键 `mcpServers`（v4.1 时代 `opencode.json.example`）已被 opencode 1.x 废弃并**静默忽略**，接线缺失无任何报错、工具直接消失；验证用 `opencode mcp list` 应显示 `mafw connected`。插件原生工具（6 个，§4.2）不经 MCP，独立可用。

### 4.2 插件侧工具（4 个，`src/tools/`）

| Tool | 用途 |
|---|---|
| `mafw_media_ask` | 分析/追问图片/视频/音频（经 Media Agent A2A；支持 taskID 多轮追问或 mediaPath 自动上传） |
| `mafw_media_upload` | 上传本地媒体文件到 Media Agent 并返回引用指针 |
| `mafw_python` | 持久 Python 内核执行（变量/导入跨调用保持；matplotlib 图表返回图片附件） |
| `mafw_python_restart` | 重启 Python 内核（内核崩溃或内存泄漏时调用） |

## 5. v6.8 新增系统

### 5.1 统一配置管理
- 三层优先级：环境变量 > `.mafw/config.yaml` > `~/.config/mafw/config.yaml` > 默认值
- 所有端口/URL/超时/路径集中在 `gateway/src/config.ts`
- 环境变量以 `MAFW_` 为前缀，路径用 `_` 分隔（如 `MAFW_SERVER_API_PORT`）

### 5.2 记忆与 Goal 解耦
- `HarmonicUnit.goal_id` 可选 —— 记忆不绑定任何 Goal
- 所有 Hooks 在无 goal 上下文时照常运行
- `recordFeedback` 存储路径已扁平化（`.mafw/feedback/`）；`askUser` 已扁平化（`.mafw/user-questions/{id}.json`，legacy 按 goal 分目录读取兜底）
- `CostEstimator.ToolCallRecord.goalId` 改为可选

### 5.3 记忆融合系统（git worktree）
- `mafw_merge_memory` MCP 工具：MinHash 比对，提取独有记忆（energy=0.4）
- 冲突处理支持 `manual` / `higher_energy` / `newer` 策略
- 存档时自动触发：`archive-worktree.ts` 在 git merge 前调用 `mergeMemoryFromWorktree()`（读源 worktree 的 harmonic index + OKF，非 legacy memories.json）
- 融合记录写入 `~/.mafw/fusion-log.jsonl`
- HTTP 端点：`POST /api/merge-memory`（插件 `/merge-memory` 命令用，复用 MCP handler）
- CLI 命令：`/merge-memory`；`/worktree-list`、`/worktree-prune` 仅存在于 deprecated legacy 插件路径

### 5.4 文件日志系统
- 插件侧 `installFileLogging()` 劫持全局 `console.log/warn/error`，写入 `<project>/.mafw/logs/mafw.log`（`src/utils/logger.ts`）
- gateway 侧日志写 `~/.mafw/logs/mafw.log`（`gateway/src/core/utils/logger.ts`）
- 格式：`[ISO时间戳] [LEVEL] 原始消息`
- 5MB 自动轮转

### 5.5 Desktop 前端（opencode-dev/packages/desktop/）
- Electron + SolidJS + `@opencode-ai/ui`
- utilityProcess 侧车运行 Gateway
- 主 UI：左侧 Rail(200px) + 上部 TabStrip + 内容区

### 5.6 Rail 侧边栏数据流
Rail 通过 `window.api.mafw.{namespace}.{method}(...)` 静态类型 API 获取数据：
```
onMount → gateway.info() 等 ready
       → invoke("project", "list")       → GET /api/projects
       → invoke("project", "current")    → GET /api/projects/current
       → invoke("session", "list", pid)  → GET /api/sessions?projectID=...
```
注意：`projects.current()` 返回的是 `Project` 对象本身，不是 `{ project: Project }` 信封。
点击"All projects"里的其他项目时，同时调 `projects.setCurrent(path)` 同步到 gateway。

所有 data fetching 在组件内 inline 使用 `createEffect`，无独立 hook。
轮询间隔：Dashboard 15s / Approvals 10s / Triage 10s / Automations 10s。

### 5.9a RightDock 用量/配额拆分（2026-09-07）
- RightDock tabs：`tasks | trajectory | usage | quota | notes`
- **UsageDock（用量）**：上下文条 + Token 统计（会话/项目/记忆三行 + **分模型统计**：今日/7天/30天/全部窗口切换、KPI 行 [总 tokens/估算成本/缓存命中率]、Top3+其他聚合、TooltipV2 五类明细）；数据 `GET /api/usage` 的 `modelStats.windows`，15s 轮询
- **QuotaDock（配额）**：ProviderSection 配额窗口（从 UsageDock 迁出）；UsagePill 点击开 quota tab；15s 轮询同一端点
- 分模型统计查询现算：`TrajectoryStore.getModelUsageStats()` GROUP BY provider+model（索引 `idx_traj_turn_ttl`），成本经 `usage/model-prices.ts` 价目表估算（无价目模型 `estimatedCost: null` 显示 `—`）

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
window.api.mafw.{sessions}.{list}()
  └─ ipcRenderer.invoke("mafw-invoke")
       └─ mafw-ipc.ts
            └─ mafwClient[ns][m](...args)
                 └─ fetch("http://localhost:<port>/api/...")
                      └─ Gateway HTTP API
```
Renderer 调用静态类型 API（`window.api.mafw.sessions.list()`），不再用 `invoke(ns, m, args)` 字符串派发。
SSE 事件直接从前端 EventSource 连 gateway，不走 IPC。

`@mafw/sdk` 包通过 workspace 解析到 `opencode-dev/packages/gateway-sdk/`，提供 `MafwClient` 类 + 全部 DTO 类型。

### 5.11 后台记忆召回（Background Recall）

系统概述 — **边界 recall + 回合末 recall** 两个机制：

```
opencode server 进程                    Gateway 进程
┌─────────────────────────────┐        ┌──────────────────────┐
│ Plugin (两个 hook)          │        │ HarmonicIndexManager │
│                             │        │                      │
│ experimental.chat.messages  │        │ GET /api/recall/     │
│  .transform                 │ HTTP──▶│ context?query=...    │
│  → 边界 recall 触发         │◀───────│ → search → format    │
│  → 注入指针块到 messages 尾部│        │ → {pointers}          │
│                             │        │                      │
│ experimental.chat.system    │        │ (无独立通道：全部记忆  │
│  .transform                 │        │  都在谐波系统中)      │
│  → 注入 <memory-guide> 到   │        │                      │
│    system 前缀（OptMem 式）  │        │                      │
└─────────────────────────────┘        └──────────────────────┘
```

实际的 recall/观察机制由两部分组成（插件观察捕获 + daemon 事件驱动注入）：

| 环节 | 时机 | 实现 |
|------|------|------|
| ① 观察捕获 | 用户消息 / 工具执行后 / text.complete / reasoning.ended / tool.failed | 插件 hooks（`src/plugin.ts`）→ `POST /api/obs/capture` 写 t1_observations |
| ② 边界 recall | **每次 LLM 调用前**（messages.transform 在 agentic 循环内；增量游标使同 turn 后续 step 近似幂等） | 插件调 `GET /api/recall/context` → `<recall>` 指针块 |
| ③ 步进注入 | `message.part.updated` 中 `part.type === 'step-finish'` + `session.idle` 事件 | daemon（gateway `index.ts` StepInject）→ 高价值记忆注入 |
| ④ 聚合压缩 | cron 每小时（turn-compress 规则） | turnCompress pipeline → per-session worker → `mafw_add_memory` |

**职责分工：** Plugin = 两个 transform 注射口。Daemon = gateway 事件流订阅四拍信号。
聚合压缩/反思 worker 的 LLM 模型由 `config.recall.workerModel` 固定（代码默认 `alibaba-cn/qwen3.7-max`，Config 页可改），per-message 传入；已存在的 worker session 下一次 prompt 即生效，无需重建。
- 为复用前缀缓存、降低 token 成本，worker session 在 idle 达到 `config.recall.workerCompactIdleMs`（默认 8h）后，下一次 prompt 会先调 opencode 的 `session.summarize` 做 compaction；summarize 失败则直接 dispose 轮换（下次 prompt 重建新会话）。
- xiaomi provider 可在 opencode 配置里开 `options.setCacheKey: true`，让请求带上 `promptCacheKey` 以便命中缓存（对端点是否生效取决于小米 API）。

### 5.12 注入点收敛

所有注入路径统一使用 `gateway/src/recall/inject-format.ts` 的 `formatRecallContext()` 渲染：

| 路径 | 注入物 | 格式 |
|------|--------|------|
| `experimental.chat.messages.transform` | pointer 块（`<recall>`） | 尾部，per-turn |
| `experimental.chat.system.transform` | 记忆操作引导（`<memory-guide>`，OptMem 式） | 前部，常驻 |
| `withMemoryInjection()` | deltas + facts + recall | 全量，每次 promptAsync |
| `/api/chat/enriched` | deltas + facts + recall | 全量，首次会话创建 |

pointer 块与全量内容块分别收敛在 `inject-format.ts` 的 `formatRecallContext()` / `renderMemoryBlocks()`。

### 5.13 主动记忆引导（OptMem 式）

**无独立于谐波记忆的通道**。所有记忆（含用户约束/偏好）都存谐波系统；`<memory-guide>` 常驻 system，让 agent **主动操作**记忆系统（参考 [OptMem](https://github.com/VictorTaelin/OptMem)）：

```
<memory-guide>
## 记忆
你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。
不主动记录，你将无法记得过去的决定、偏好与教训。

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的坑
  → 调用 mafw_add_memory（选择 semantic/episodic/procedural，附 cueAnchors）
- 不写冗余记忆

### 需要旧记忆：主动检索
- 新任务开始、或不确定此事是否已知 → 调用 mafw_search_hybrid 检索

### 子代理
子代理不得调用 mafw_add_memory / mafw_search_hybrid（防重复写入），由父会话统一管理
</memory-guide>
```

- 实现：`src/hooks/memory-guide.ts`，经 `experimental.chat.system.transform` 每轮注入（常驻）
- 被动注入（chat 开头 recall / tool-calls 增量 / step-ended 注入）保留，与主动引导互补：被动 = 系统帮你想起，主动 = agent 自己管理
- 旧 `.mafw/constraints.json`（pinned 约束独立通道）已废弃：启动时自动迁移为谐波记忆（semantic、energy 0.9）并改名 `constraints.migrated.json` 备份（幂等，`gateway/src/recall/constraints-migrate.ts`）

#### Pinned 披露层（2026-08-28）

`pinned` 是 HarmonicUnit 一等标志（与 type 正交）：pinned 且未 superseded 的记忆经
`GET /api/recall/pinned` 渲染为 `<user-profile>` 块，由插件 system.transform 每轮注入
（`<memory-guide>` 之后，半稳定内容靠后保前缀缓存；fail-open 150ms 超时）。预算
20 条/2000 字符，按 energy×salience 截断（salience 缺失按 1），溢出记
`[Recall] pinned overflow` 日志。知识更新：`mafw_add_memory { supersedes: 旧id }` 显式取代
（复用 MinHash soft-supersede 链，新条目 energy 继承 max(0.8, 旧条目) 且 pinned 不继承）；
纠错正门 `mafw_pin_memory`。渲染收敛在 `inject-format.ts:formatPinnedProfile()`，
路由逻辑在 `routes/pinned-recall.ts`（deps 注入可单测）。
不加独立 update/delete 工具（业界实践：记忆变异属后台管线——下期 turnCompress 矛盾检测）。

#### Sticky 便签板（2026-09-07）

`sticky_until` 是 HarmonicUnit 一等字段（ISO 日期；OKF frontmatter 白名单需显式携带，index entry 为板成员资格权威来源、渲染时回退）：未过期且未 superseded 的记忆经
`/api/recall/context` 尾部渲染为 `<note-board>` 块（`routes/note-board.ts`，deps 注入可单测；
渲染 `inject-format.ts:formatNoteBoard()`），解决"用户说'记下来'但只有 BM25 词面匹配才能想起"
的缺口——检索条件化之外的有保质期保证送达层。语义对齐业界调研（mem0 expiration/
Graphiti invalidation）：**板级过期 ≠ 记忆删除**，到期仅下架，本体照常可被 BM25 检索；
坏日期 fail-open 留在板上并排最后；排序按到期近者优先（紧急提醒前置）。预算 10 条/800 字符，
溢出记 `[Recall] note-board overflow` 日志。写入：`mafw_add_memory { sticky: true, stickyDays? }`
（默认 7 天）；管理：`mafw_pin_memory { id, sticky, stickyDays? }` 上板/续期/下架。
`mafw_get_memory` 补齐指针兑现：按全 id 或 `<recall>` 尾 6 位取全文，superseded 自动沿链附最新版；
HTTP 等价 `GET /api/memory/get?id=`。业界三层映射：pinned=Letta core blocks（永久可见）、
sticky=OptMem wake（近期可见）、BM25=archival（按需检索）。桌面呈现：`GET /api/memory/sticky`
（结构化 entries+budget，fail-open）→ SDK `memory.listSticky/setSticky` → 右侧 Dock「📝 便签」tab
（NotesDock：倒计时 ≤1 天红色高亮、续期/下架/删除、预算徽标、15s 轮询）。

### 5.13a 数据目录与统一数据库

**MAFW 数据根固定为 `os.homedir()/.mafw`**（`config.resolvePath()`，与启动 cwd / MAFW_PROJECT_DIR 完全解耦；`paths.mafwDir` 配置覆盖失效）。启动时自动迁移 gateway 包目录旁的旧数据（`gateway/src/recall/data-dir-migrate.ts`，幂等，删除旧位置）——注意迁移源是 `<gateway包>/../.mafw`，**不是** project-relative `.mafw`；插件侧仍会在项目目录重建 `.mafw/`（日志与请求文件等）。

**统一数据库 `~/.mafw/memory/gateway.db`**（`GatewayDatabase`，`gateway/src/memory/gateway-db.ts`）：
- `t1_observations`：回合观察（插件经 `/api/obs/capture` 写入，turnID 网关分配，UNIQUE 去重）
- `kv_store`：易失关键小状态——
  - `manager-session`（key=projectDir，**per-project manager session**，替代旧 manager-session.json）
  - `reflect-cursor`（key=sessionID，反思增量游标）
  - `registry/snapshot`（注册表快照，权威仍在 `scheduler/registered-projects.json`）
- 旧 t1.db / manager-session.json / recall-reflect-cursor.json 启动时自动回填并入库后删除（`gateway/src/recall/gateway-db-migrate.ts`，幂等）
- `GET /api/manager/session` 返回全部项目的 manager session 列表（`?projectDir=` 过滤单条）
- `POST /api/manager/session/rotate`（`{projectDir, reason?}`，`routes/manager-rotate.ts`）：**开新话题**——旧 session metadata 降级 `role: 'manager-archived'`（去 pinned/exempt，回归普通生命周期，自动出现在桌面历史列表），强创建新 session 替换 kv 并重跑身份注入；与 `ensureManagerSession` 经 `managerSessionInflight` 互斥。MCP `mafw_new_topic` 复用同一 flow

**Manager 常驻目标感知（2026-09-03）**：
- **每轮 goal 快照**：`GET /api/recall/context` 识别活跃 manager session（kv sessionId 比对）后在 recall 块尾部追加 `<goal-snapshot>`（`core/manager/goal-snapshot.ts` 确定性聚合，≤10 条/500 字符，compaction 免疫）；非 manager session 不受影响
- **里程碑推送**：`core/manager/milestone-push.ts` 挂 `eventBus("phase_transition")`（PLANNING_COMPLETE/REVIEWING_COMPLETE/ASKING_USER）+ `archiveGoal()`（completed/failed/cancelled），per-project 合并队列（5s），持久化去重键 `milestone-notified/{goalId}:{phase}:{stateVersion}`，`promptAsync(noReply: true)` 硬免回复（消息落历史不触发 LLM；pi runtime busy 分支会丢 noReply 语义——已知限制）
- **/btw 支线问答**：用户直发指令（桌面 `/btw` slash 命令 / 插件 `/btw` command → `/api/mafw-commands/run`），spawn 一次性 session（registerInternal 'btw'，不回流 T1），prompt 一次拿回答即删；`new-topic`/`btw` 均为**用户指令驱动**（UI-driven, not LLM-driven），刻意不暴露 MCP 工具给 agent
- 旧三条 `manager-report-*` 自动化规则已退役（wake 链路读已删除的 legacy 文件 + 事件无人 emit，整链死代码），`ensureManagerRules` 启动时清理规则文件

**聚合压缩（memory:turnCompress，每小时）**：每活跃 session 将本小时所有完成回合合并为一份 batch transcript，交给该 session 的**持久 worker 会话**，由 agent **自主调用 `mafw_add_memory`** 记录值得长期记忆的条目（类型按内容自选）。处理过的回合**一律删除**（空/失败不重试）。内部 worker 会话经 `/api/obs/capture` 的会话白名单过滤——**输出永不回流 T1**（防递归）。

### api/recall/context endpoint

```
GET /api/recall/context?sessionID=xxx&query=xxx
Response: { pointers: string|null }
```

- v0：同步 HarmonicIndexManager.search(query, 3) → formatRecallContext()
- fail-open：超时/错误返回 `{ pointers: null }`，不阻塞 LLM 流程
- 已推送记忆过滤：路径 1（step-ended 注入）登记过的记忆 ID 不再通过本端点重复暴露
- 未来：daemon 预计算好注入载荷，endpoint 读快照 ~1ms

### 5.14 Media 接入（A2A Media Agent，pi 引擎 · 多模态）

纯文本/多模态推理模型通过 **A2A 协议**（Agent2Agent v1.0）与 gateway 内置的
**Media Agent** 多轮协作分析 **图片 / 视频 / 音频**。**推理 Agent（LLM）主动驱动**，
MAFW 插件仅作为 A2A 客户端执行。媒体分析引擎是 **pi-coding-agent**
（`@earendil-works/pi-coding-agent`，进程内 SDK 嵌入），模型经每模态配置指定
（默认 `xiaomi/mimo-v2.5`，直连小米 API，认证复用 opencode auth.json 的凭据）。

```
MafwShell（桌面前端）                           Gateway 进程（3000）
  粘贴/上传图片/视频/音频 → POST /a2a SendMessage  gateway/src/media/media-agent.ts
    parts: [{raw: 媒体base64}, {text: 问题}]       ├─ A2A JSON-RPC（@a2a-js/sdk v1.0.1）
  → 消息只发文本指针                               ├─ POST /a2a、/.well-known/agent-card.json、
    [媒体附件 taskID: x contextID: y（媒体: 名）]   │  /a2a/artifacts/<id>（loopback-only）
                                                  ├─ TaskStore + ArtifactStore（LRU 500 + TTL 24h）
opencode LLM（推理 Agent）                       └─ MediaService → pi adapter → 模型（每模态可配）
  看到指针 → 自主调用 mafw_media_ask                └─ gateway/src/media/pi-adapter.ts
    src/tools/media-ask.ts（插件 tool，A2A client）    ├─ pi-coding-agent（ModelRuntime，进程内 SDK）
      ├─ GetTask { id: taskID } → contextId          ├─ 认证：opencode auth.json 的 provider key
      └─ SendMessage { contextId, referenceTaskIds:    │  （setRuntimeApiKey 运行时注入，不落盘）
           [taskID], parts: [{text: question}] } → 追问  └─ fixMediaPayload（onPayload 钩子）
    返回：媒体回答 + 新 taskID（继续追问用新 ID，媒体不重传）
```

要点：
- **纯 A2A，无 MCP、无 transform 自动转发**：追问由推理 Agent 自主决策（调用
  `mafw_media_ask` 工具）；媒体只上传一次（raw FilePart），追问经
  `referenceTaskIds` 引用前序任务，每轮是一个新任务（同步模型下任务即时终结）
- **多模态（image / video / audio）**：MediaAgent 的 `SUPPORTED_INPUT_MODES` 为
  `['text','image','video','audio']`，按 mediaType 白名单路由；大小上限：
  image ≤20MB / video ≤50MB / audio ≤25MB（超限显式失败）
- **媒体原生进入主模型**（非"描述注入文本模型"）：媒体作为 PiAiImage carrier
  （`{type:'image', data: base64, mimeType: video/mp4|audio/...}`）交给 pi；
  pi 的 openai-completions 序列化器输出 `image_url`，**fixMediaPayload**
  （`gateway/src/media/pi-adapter.ts`，派生自 pi-multimodal-proxy 的
  fixVideoAudioPayload，MIT）在 `onPayload` 钩子里重写 wire format：
  - `video/*` → `{type:'video_url', video_url:{url}}`（小米视频格式）
  - `audio/*` → `{type:'input_audio', input_audio:{data:url}}`（小米音频格式，
    data 为整串 data URI）
  主模型（如 xiaomi/mimo-v2.5）直接分析媒体，`video_tokens`/`audio_tokens`
  真实计入（实测验证）
- **每模态独立模型**：gateway `media:` 配置段——`provider`/`model`（默认
  xiaomi/mimo-v2.5）+ `image/video/audio` 每模态 `{provider?, model}` 覆盖；
  经 pi 的 `getModel(provider, modelId)` 解析；桌面 Config 页可编辑
- **认证复用 opencode**：key 从 `~/.local/share/opencode/auth.json` 按 provider
  读取（opencode 里 connect 即可），`setRuntimeApiKey` 运行时注入，无独立
  MAFW API key
- **CJS/ESM 桥**：gateway 编译为 CJS，pi-coding-agent 是 ESM——pi-adapter 通过
  `new Function('spec','return import(spec)')` 运行时动态导入（tsc 会把普通
  `import()` 降级为 require，require ESM 包会抛错）
- 工具描述强化 LLM 可读性：触发条件（会话存在 `[媒体附件]` 指针）、taskID 从
  指针提取、返回含新 taskID；`ToolResult` 结构化
  `{ title, output, metadata: { taskID, newTaskID } }`
- 错误处理：GetTask TaskNotFound / SendMessage 失败 / 任务 FAILED / gateway 不可达
  → 显式错误文本，不抛异常不崩会话
- **标准 opencode（无桌面端）完整可用**：
  - 入口 A：`src/hooks/media-ingest.ts`（transform）——粘贴图片/视频/音频
    自动建任务并替换为文本指针；`MEDIA_INGEST=off`（兼容 `VISION_INGEST=off`）可关
  - 入口 B：`mafw_media_upload` 工具——LLM 主动上传本地媒体路径建任务
  - 追问：`mafw_media_ask`；指针 `[媒体附件 taskID: x contextID: y（媒体: 名）...]`，
    幂等兼容旧 `[视觉附件` 前缀；参数 `mediaPath`
- 安全：`/a2a` 系列端点 loopback-only（403 拒绝非本机）；Artifact id 为 uuid 不可猜；
  FilePart `url` 只接受本 agent 工件引用（SSRF 防护）
- 前端（MafwShell）媒体附件 → `window.api.mafw.media.createTask` → 文本指针；
  图片走 canvas 下采样，视频/音频直读 dataUrl
- 工具清单：`mafw_media_upload`（建任务，返回指针 + taskID）、`mafw_media_ask`
  （追问，返回回答 + 新 taskID）；旧名 `mafw_vision_upload`/`mafw_vision_ask` 已移除
- **MediaRuntimeExecutor**（`gateway/src/media/media-runtime-executor.ts`）：媒体 agent 的
  AgentRuntime 后端——pi runtime 激活时 `resolvePrompt` 的 `engine='pi'` 分支返回 executor 的
  PromptFn；图片追问在同一 AgentSession 内连续 prompt（真多轮记忆，同一 dataUrl + provider/model
  复用会话，追问轮自动回退到最近会话）；视频/音频保持 ModelRuntime.complete + fixMediaPayload
  单次路径；超时 180s + abort；A2A cancelTask → cancelHook → cancelInflight 中止进行中会话
- 测试：`tests/unit/gateway/pi-adapter.test.ts`（fixMediaPayload 单测 + adapter 边界）、
  `media-service.test.ts`（PromptFn 抽象隔离）、`media-agent.test.ts`（A2A 四模态）、
  `media-runtime-executor.test.ts`（会话复用/超时/cancel）

#### 5.14a Media Engine 插件系统

媒体分析引擎可插拔：用户往 `~/.mafw/media-plugins/` 丢 `.js` 文件即可替换/新增某模态的分析引擎。
`MediaPluginLoader`（`gateway/src/media/media-plugin-loader.ts`）扫描/热加载/fail-open，
`MediaService.resolvePrompt(kind, cfg)` 按模态路由到插件引擎或默认 pi。

**两种插件形态**（CJS `module.exports`）：

```js
// 形态 A：完全自定义引擎（不经 pi，直接 HTTP 调用）
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],
  async createPrompt(ctx) {
    return async (parts, opts) => { /* 返回分析文本 */ };
  },
};

// 形态 B：复用 pi 运行时，只换 wire 格式修复器
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) { /* 自定义改写，返回 undefined 表示不修改 */ },
};
```

**ctx**（`gateway/src/media/plugin-context.ts`）：`apiKey(name)` / `fetch(url, opts)`（60s timeout）/
`pluginConfig(name)`（读 `config.media.pluginConfig`）/ `log`。

**config 路由**（per-modality 覆盖全局）：
```yaml
media:
  engine: pi              # 默认引擎
  video:
    engine: qwen-vl       # video 模态走插件
  pluginConfig: {}        # 插件自定义配置
```

**HTTP API**：`GET /api/media/plugins`（状态列表）、`POST /api/media/plugins/reload`（手动重载）。
校验失败 fail-open（状态记 error，不影响其他插件与默认 pi）。
`pi-adapter` 的 `fixPayload` 现为可选 dep（默认 `fixMediaPayload` 小米格式），插件可覆盖。
缓存 key 含 engineName 防同模型不同引擎串缓存。
测试：`tests/unit/gateway/media-plugin-loader.test.ts`（11 例）、`media-service.test.ts` resolvePrompt 路由（4 例）。

### 5.15 OpenCode Serve Sidecar（自监管）

opencode serve（4096）由 gateway 以 **sidecar 子进程**方式直接监管
（`gateway/src/serve-sidecar.ts`，替换 SDK `createOpencodeServer` 封装）：

- **spawn 契约与 SDK 完全一致**：`createOpencodeServer` 内部使用 cross-spawn、
  `opencode serve --hostname=127.0.0.1 --port=4096`、env `OPENCODE_CONFIG_CONTENT="{}"`、
  就绪信号 stdout `opencode server listening on <url>`（超时 5s 树杀报错）
- **健康轮询监督**：SDK 不暴露子进程/exit 回调，**owned 与 adopted serve 都走 watchdog**：
  每 30s 探测 `/global/health`，连续 3 次失败 → `recoverServe()` 重启并**重订阅事件流**
  （SSE 建立在 serve 之上，进程重启后必须重连，否则自动化触发器和桌面 SSE 转发全部静默失效）
- **windowsHide 必须显式传**（2026-09-07 黑窗事故）：gateway 以 detached（无控制台）运行时，
  无 `windowsHide: true` 的 spawn 每次都会创建**可见控制台窗口**——用户关窗 = 杀掉 serve，
  watchdog 重启又弹新窗，形成"黑色弹窗关掉还会弹"的循环。SDK `createOpencodeServer` 不传
  windowsHide，故 `serve-sidecar.ts` 已改回**手写 spawn**（保留 SDK 契约：参数、
  `OPENCODE_CONFIG_CONTENT`、ready 行解析、taskkill /F /T 树杀）
- **退避策略**：连续崩溃 streak 1/2/3 次 → 0/5s/15s 快速重试；≥4 次 → 5min 间隔；
  streak 仅在 serve 稳定运行 60s 后清零（防 flapping 热重启）
- **adopted 场景**：gateway 崩溃后孤儿 serve 存活，新 gateway 启动时
  `isServeHealthy()` 探到则**收养**（不重新 spawn），watchdog 同上
- **恢复动作收敛**：共用 `recoverServe()` = `killProcessOnPort(4096)` + `startServe()` + `subscribeToEvents()`
- **手动恢复入口**：`POST /api/runtime/restart-agent`（SDK `runtime.restartAgent()` / Config 页按钮 /
  MCP `mafw_restart_agent`）触发与 watchdog 相同的编排（kill+respawn+事件流重订）；external 模式 503
- 外部 serve 模式（`MAFW_SERVER_SERVE_URL`）不监管（用户管理的进程）
- serve 的 stdout/stderr 由手写 spawn 经 `onOutput` 转发（index.ts 以 `[Serve]` debug 日志记录），
  serve 崩溃原因不再静默；诊断同时依赖 watchdog 的 "Serve unhealthy" / recovery 日志
- 经验：子进程型依赖必须配监督（检测点不能在启动时一次完事）；恢复动作必须完整
  （重启进程 ≠ 恢复连接，事件订阅要一并重连）；
  **detached 环境下所有子进程 spawn 必须带 `windowsHide: true`**（python kernel / llamacpp / tray 均已带）

### 5.16 自更新（Self-Update，不依赖 desktop）

gateway 可自行构建新代码并**子进程接力重启**（`gateway/src/self-update.ts`）：

- **触发协议**：`~/.mafw/pending-restart.json`（homedir 控制面）——
  `{ target: "gateway", action: "update"|"restart", reason?, delayMs?, commit? }`；
  原子写（`.tmp` + rename）；gateway 2s 轮询，先删令牌防循环，坏 JSON 连续 5 次后删除
- **更新动作**：`action: update` → 包根 `npm run build`（exit 0 + dist 校验）→ 顺带
  `npm pack` + `npm install -g`（尽力而为，失败不阻塞）；`restart` 跳过构建
- **接力重启**：spawn 新进程（`MAFW_TAKEOVER=1`，同入口 dist）→ 2s 确认存活 →
  优雅 `stop()` + exit；新进程 2s 内崩溃则**取消重启**，旧进程继续服务；
  失败安全：build 失败/坏令牌均不重启
- **TAKEOVER 分支**：跳过单实例守卫 → 等 3000 释放（≤30s）→ 接管 → 更新
  `~/.config/mafw/gateway.pid`（CLI status/stop 继续有效）
- **调用者定位**：事件流中 bash 工具命令含 `pending-restart` 的会话 = 写令牌者
  （确定性）；兜底最近活跃会话
- **完成通知**：新 gateway 启动完成 + recoverState 后，向调用者会话 `promptAsync`
  注入 `[MAFW SYSTEM] 自更新已完成...`（同会话自动续跑）；调用者未知时兜底通知
  **主项目** manager session（不做全项目广播——其他项目 manager 收到只烧 token，
  2026-09-08 修复）；失败 → `notified:false` + 被动续跑（agent 读 last-restart.json）
- **记录**：`~/.mafw/last-restart.json`（reason/commit/requestedAt/sessionID/notified）
- 等价入口：`mafw update` CLI（写同一令牌；无会话上下文 → manager 兜底通知）
- 非目标：git 远端拉取（无 remote）、定时自动更新、进程内热替换（重启 ~2-3s，
  文档声明中断窗口）；dev 模式自举以 dist 为准
- agent 操作手册：`.opencode/skills/mafw-gateway-restart/SKILL.md`（七步流程）

### 5.17 持久 Python 内核（Prime Agent 同款 Jupyter kernel）

给 agent 一个会话级持久 Python 环境（变量/导入/数据跨工具调用保持），Prime Agent
（`packages/coding-agent/src/core/kernel/`）同款架构：

```
opencode LLM                              Gateway（3000）                  .venv-pykernel
  mafw_python { code } ──→ POST /api/python/execute ──→ KernelService ──ZeroMQ──→ ipykernel_launcher
    （ToolContext.sessionID 定位内核）        ├─ session→kernel Map           ├─ 标准 Jupyter 协议 5.3
  mafw_python_restart    ──→ /restart        ├─ Mutex 串行队列（防并发踩踏）   ├─ allow_stdin:false
                                             ├─ 崩溃检测→自动重启+提示        └─ matplotlib 附件（display_data）
                                             └─ TTL 1h 闲置回收
```

要点：
- **`gateway/src/python/kernel-service.ts`**：Jupyter wire 协议（ZeroMQ Dealer/Subscriber，
  HMAC 签名按 jupyter_client 的 `json.dumps` 分隔符 + `ensure_ascii=False` 字节序列化）；
  `execute` 收集 stdout/stderr/execute_result/display_data（matplotlib 图→base64 附件）/
  error{traceback}；输出 cap 65536 + `truncated` 标记；超时→control 通道 interrupt；
  崩溃（exit 事件）→ 标记 dead → 下次调用自动重启并返回 `kernelRestarted: true`
- **Windows 陷阱**：`child.kill('SIGKILL')` 无效 → `taskkill /F /T` 兜底；zeromq receive
  用 `Promise.race` 超时会留下"幽灵 receive"吞消息 → 同一时刻只挂一个 receive、
  超时仅做检测（有 pending 才判死）；循环用 `socket === this.iopub/shell` 判断
  被替换（重启后旧循环静默退出）
- Python 环境：`.venv-pykernel`（专用，ipykernel/numpy/pandas/matplotlib），
  `MAFW_PYTHON_BIN` 可覆盖
- 安全：loopback-only；无沙箱（本机可信场景）；TTL 1h 回收 + 停机清理
- 引导：工具描述强化（数据分析/统计/多步计算 → 用 mafw_python 而非 bash python -c）+
  `bash-python-guide` hook 检测长 python 内联脚本注入温和提示（每会话一次）
- 测试：kernel 集成套件需 `--runInBand --forceExit`（真实内核 + zeromq handle 残留）

### 5.18 Manager Agent 权限（对齐 plan + gateway MCP 白名单）

manager agent 通过 `agents.install('manager', getManagerAgentDefinition())` 安装
（定义见 `gateway/src/skills/manager-agent-config.ts`）；系统规则由 `ensureManagerRules()`
（`gateway/src/core/manager/system-rule-templates.ts`）每次启动写入 `~/.mafw/`：

- **`edit: {"*": "deny"}`**：禁用 edit/write/apply_patch（不能直接改文件/代码）——与内置 plan 对齐
- **`task: {"general": "deny"}`**：不派发 opencode 子任务（委派走 `mafw_set_goal` MCP 工具）
- **bash 默认 allow**：执行命令不受限（自更新等流程经 bash 通道；与 plan 同级）
- **gateway MCP 工具显式 allow**：38 个 `mafw_*` 工具白名单（`mafw_set_goal`/`mafw_update_state`/
  `mafw_ask_user`/记忆/自动化/桌面控制等）——opencode 权限按工具名匹配，`edit` deny 不影响
  MCP 工具；显式 allow 防未来 defaults 收紧（如 `"*": "ask"`）时误伤
- 机制依据：opencode `permission/index.ts` 的 `disabled()`——仅 `edit/write/apply_patch` 映射到
  `edit` key，其余工具用工具名作 permission key
- 自更新影响：manager 不能 edit 文件 → SKILL.md 要求自更新全流程用 bash 命令执行（bash 默认允许）

### 5.19 Runtime 能力契约（多 runtime 接缝）

gateway 与 agent runtime 之间是**能力自声明契约**（`gateway/src/runtime/`）：

- `contract.ts` — `RuntimeCapabilities`（sessionApi/promptWhileBusy/eventStream/
  nativeApprovals/providerConfigApi/perLlmCallTransform/sessionStorageApi/agentConfigApi/
  agentProcessApi）
  + `RuntimeClient` 接口面 + `AgentRuntime`。能力分级：Tier 0（协作协议 + per-turn 记忆）
  → Tier 1（+ 自治执行 + per-step 记忆）→ Tier 2（+ 桌面完整，opencode 形状 DTO 归一化输出）
- `normalize.ts` — runtime 原生事件 → `EventFacets`（正交切面：step/chatSignal/
  broadcast/toolCommand）；opencode 版本知识（≥1.18 step-finish part 结算）只存在于
  本文件和 step-inject.ts 的两个 helper
- `opencode-runtime.ts` — 内置恒等实现（全能力，`external` 跟随 MAFW_SERVER_SERVE_URL）；
  内含 opencode 专属实现：SQLite session 存储（`sessionStorageApi`）、auth.json 凭据
  （`credentials`）、agent frontmatter 序列化（`agents.install`）
- `agent-definition.ts` — 运行时中立的 `AgentDefinition` 模型（description/mode/model/
  systemPrompt/permissions），各 runtime 翻译为自己的配置格式
- `loader.ts` — `~/.mafw/runtime-plugins/*.js` 插件加载（CJS `module.exports =
  { name, capabilities, createRuntime(ctx) }`，fail-open，`POST /api/runtime/reload`
  可热重扫插件文件；能力声明覆盖在 Tier-0 基线之上）

**可选能力与接口扩展：**
- `external?: boolean` + `getBaseUrl(): string` — runtime 声明托管模式；`external=true`
  时 gateway 不 spawn/不 kill，watchdog 仅健康探测 + 事件流重连
- `credentials?: { getApiKey(provider): string | null }` — 凭据获取；media 服务优先走
  runtime credentials，回退直读 auth.json
- `sessionStorageApi?: boolean` + `session.listByDirectory?(dir, limit)` — 直读 runtime
  私有存储列出会话；缺失时回退 `session.list` + 客户端目录过滤
- `agentConfigApi?: boolean` + `agents?: { install(name, definition); remove?(name) }` —
  agent 定义安装；缺失时跳过 + warn 日志（manager 功能降级但不崩）
- `agentProcessApi?: boolean` + `agentProcess?: { restart() }` — agent 进程生命周期管理；
  opencode owned runtime 为 true（kill+respawn serve sidecar）；external/pi 为 false
- `completionApi?: boolean` + `completion?: { complete(req) }` — 无状态单次补全通道
  （index-scan 与 media 无状态路径优先走契约，fail-open 回退直连 HTTP，
  共享实现在 `runtime/completion-http.ts`）；`cacheable` 是 prompt-cache 提示非承诺
  （直连传输映射为 DashScope `cache_control: ephemeral`，其他 runtime 可忽略）；
  usage 由消费侧记账，runtime 只负责返回

激活插件：`config.yaml` 的 `runtime.plugin: <name>`（或 `MAFW_RUNTIME_PLUGIN`）；
未配置/加载失败一律回退内置 opencode。可观测：`GET /api/runtime` 返回当前
runtime 能力集 + 插件扫描状态。能力门：缺能力的 runtime 对应端点 503、
事件订阅跳过，不崩溃。

#### Runtime 热切换（无需重启）

运行时切换有两种触发路径，均**不重启 gateway 进程**：

| 触发方式 | 入口 | 流程 |
|----------|------|------|
| **HTTP API** | `POST /api/runtime/switch { plugin }` | 校验插件存在（未知 400 + available 列表）→ `config.persistOverrides` 持久化到 `~/.mafw/config.yaml` → `createRuntime()` 重建 → 接线 client/consumers → `resubscribeEvents` 重订阅事件流（AbortController 取消旧订阅，防孤儿迭代）→ dispose 旧 runtime |
| **Config hot-reload** | `config.yaml` 文件变更 watcher（2s 防抖） | `config.reload()` 检测 `runtime` 段变更 → 自动执行同上 createRuntime + resubscribe 流程；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖 |

辅助端点：
- `GET /api/runtime` — 当前 runtime name/capabilities + envOverride + 插件扫描状态
- `POST /api/runtime/reload` — 重扫 `~/.mafw/runtime-plugins/*.js`（清 `require.cache` 后重新 require），不切换，仅刷新插件列表

热切换安全约束：
- `server`/`paths` 配置段变更仍需重启（`config.reload()` 返回 `restartRequired`）
- `apiToken` 变更即时生效，无需重启
- 插件 `createRuntime()` 抛异常 → 回退内置 opencode，不崩 gateway
- 旧 runtime dispose 由 `onSwitched` 回调统一处理（pi: registry 清空 + event stream 终止）

宿主插件侧（runtime 进程内的 transform/工具注册）是每个 runtime 单独交付物，
不在本契约内；gateway 侧 HTTP（/api/obs/capture、/api/recall/context、/a2a）
对宿主插件保持 runtime 中立。

**内置插件：pi-coding-agent runtime（`gateway/src/runtime/plugins/pi-runtime.ts`）**
- `config.runtime.plugin: pi` 激活；进程内 SDK 嵌入（ESM 桥 `new Function('spec','return import(spec)')`）
- 能力：sessionApi/promptWhileBusy/eventStream/nativeApprovals/providerConfigApi/sessionStorageApi/agentConfigApi true
- 认证链：`ctx.credentials.getApiKey` → auth.json 回退 → ModelRuntime.setRuntimeApiKey（单例共享）
- 会话：`PiSessionRegistry`（Map<sessionID, AgentSession>，忙时 followUp 队列）
- 存储：`pi-session-storage.ts`（调用 pi SessionManager.list(cwd) 列出持久化会话，映射为 gateway SessionInfo 格式）
- 事件：`PiEventStream`（subscribe → RawRuntimeEvent → normalize.ts 四信号 session.idle/session.error/message.part.updated/message.updated）
- external=true：gateway 不 spawn；外部 runtime 的事件订阅与 serveReady 解耦（不等 opencode serve）
- 媒体 agent 消费 AgentRuntime（Phase 2，见 `docs/superpowers/specs/2026-08-27-pi-runtime-design.md`）

#### nativeApprovals 翻译层（pi runtime）

pi runtime 声明 `nativeApprovals: true`，通过 MafwApprovalExtension 拦截 tool_call 事件：

1. **ApprovalBridge**（`pi-approval-bridge.ts`）：每个 session 独立的 Promise map，5 分钟超时自动拒绝
2. **MafwApprovalExtension**（`pi-approval-extension.ts`）：pi extension，拦截 tool_call，发射 permission.asked/replied 事件
3. **事件翻译**（`pi-events.ts`）：`translatePiEvent` 将 permission.asked/permission.replied 翻译为 opencode 形状，经 `normalizeOpencodeEvent` 归一化为 EventFacets
4. **HTTP API**：`POST /api/sessions/:sessionID/permissions/:requestId` 转发到 `runtime.session.permissionReply`
5. **配置**：`runtime.pluginConfig.pi.approvalPolicy` 自定义 autoApprove/autoDeny 列表

默认策略：read/grep/ls/find/glob 自动放行，其余需审批。

#### 插件切换端点（runtime / media，桌面 Config 页「插件 Plugins」卡片）

- `GET /api/runtime` — active runtime（name/capabilities/**envOverride**）+ 插件扫描状态；`POST /api/runtime/switch { plugin }` — **热切换**（进程内重建 runtime，无需重启）：校验插件存在（未知 400 + available）→ `config.persistOverrides` 持久化 → `createRuntime` 重建 → 接线 client/consumers → **`resubscribeEvents` 重订阅事件流**（AbortController 取消旧订阅，防孤儿迭代）→ dispose 旧 runtime（pi 的 registry + event stream）；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖；`POST /api/runtime/reload` 重扫插件文件
- `POST /api/media/switch { engine?, image?: {engine?}, video?: {engine?}, audio?: {engine?} }` — 校验引擎名（未知 400 + available；pi 恒可用）→ 持久化 + `mediaPluginLoader.reload()` **热生效**；返回 `{ success, media: {engine, image, video, audio} }`
- `GET /api/model-config` / `POST /api/model-config` — 记忆 worker 模型 + 媒体每模态模型（`recall.workerModel`、`media.provider/model`、`media.{image,video,audio}`）：provider 列表来自 `GET /api/provider`（不可用 fail-open）；POST 严格校验（空字符串=清空回退，跳过校验）→ `config.persistOverrides` 落盘 → 仅 recall 变更时置空 `scanService` 单例（TurnPipeline/ReflectionPipeline 每次新建本就热生效；媒体 per-request 读 config 天然实时）；路由 `routes/model-config.ts`，deps 注入可单测；SDK `models` 命名空间 + 桌面 Config 页「模型 Models」卡片
- `GET /api/memory/embedding-config` / `POST /api/memory/embedding-config` — 记忆嵌入引擎设置（provider/engine/model/threads + llamacpp.gpu/threads/contextSize）：POST 校验枚举 → `persistOverrides` → **热切换**（kill 旧 llama-server sidecar → 重建 EmbeddingRuntime → 后台 backfill）；写路径 `onMemoryWritten` 监听已改为懒解析 `getEmbeddingRuntime()`，热换不留 stale provider。**路由必须注册在 `/api/memory/*` dashboard 兜底委托（index.ts ~2970 行）之前**。向量文件按 provider.name 打标签，gpu 变体间共享（同模型嵌入空间一致）；路由 `routes/embedding-config.ts`；SDK `embedding` 命名空间 + 桌面 Config 页「Memory」区块
- 切换逻辑在 `gateway/src/routes/{runtime-switch,media-switch,model-config,embedding-config}.ts`（deps 注入，可单测），index.ts 仅薄接线
- 桌面 Config 页：Runtime 下拉（`SelectV2`，选择后 `confirm()` 二次确认 → switch → toast；`envOverride` 显示警告条）+ Media 每模态下拉（热生效）+ 模型 Models 卡片（级联双 `SelectV2`，provider 变更时重置 model 下拉并过滤）；SDK `MafwClient.runtime/media/models` 命名空间 + preload 对应方法

### 5.20 Goal 编排 RSI — Phase 1 观测层

**数据模型**（gateway.db）：
- `goal_outcomes`：每个 goal 归档时写一行（verdict、轮数、成本、thumbs、policy_version、failure_kind/signature）
- `goal_sessions`：goal 生命周期内所有 session 的追加映射（豁免 trajectory prune——保留期 `trajectory.retentionDays`，默认 365 天，0=永久）
- `evolution_proposals`：演化提议表（Phase 2 使用，Phase 1 仅建表）

**写入点：**
- 三个 session 创建节点（plan/execute/review）调用 `onSessionCreated` 追加 goal_sessions
- archiveGoal 成功后调用 `recordGoalOutcome` 聚合 trajectory + feedback 写入 outcome
- ABORT（HTTP + control file）调用 archiveGoal(verdict='CANCELLED')
- onGoalCreated 时 `policySnapshot` 写入 state.json

**查询：**
- `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=`

**组件注册表：**
- `gateway/src/orchestration/registry.ts` 声明可演化组件（Phase 1 只读）
- `gateway/src/orchestration/policy.ts` 读 `~/.mafw/orchestration/active.json` 回退 builtin-v1

## 6. Gateway 运维

### 6.1 CLI 命令
Gateway 唯一运维入口是 `mafw` CLI，用 `npm install -g` 全局安装或 `npx mafw` 使用：

```bash
# 进程管理
mafw status            # 查看运行状态
mafw start             # 前台启动
mafw daemon            # 后台启动
mafw stop              # 停止
mafw restart           # 重启前台（stop + 1s + start）
mafw restart-agent     # 重启 agent serve sidecar（POST /api/runtime/restart-agent；external/进程内 runtime 返回 503）

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

### 6.2 日志路径
Gateway 的 console.log/warn/error 自动写入文件：
- `~/.mafw/logs/mafw.log` — 文件日志（daemon 模式下也用这个）
- 5MB 自动轮转，格式 `[ISO时间] [LEVEL] 消息`
- Error 对象在日志中需要用 `err.message` 而非 `err`（JSON.stringify Error → {}）

### 6.3 重启注意事项
- Restart 前会自动 kill 旧进程（基于 PID 文件）
- 如果旧进程是非 CLI 启动的，先 `mafw stop` 再 `mafw start`

### 6.4 构建、安装与发布

```bash
npm run build                 # 构建 plugin + gateway
npm pack                      # 打包为 .tgz（324 kB）
npm install -g opencode-plugin-mafw-4.1.0.tgz    # 全局安装
mafw version                  # 验证安装
```

发布后用户只需 `npm install -g opencode-plugin-mafw` 即可使用 `mafw` CLI。

**完整重装流程（清旧 + 构建 + 安装）：**
```bash
npm run build
npm pack
npm install -g opencode-plugin-mafw-*.tgz     # 覆盖旧版本
```

**注意事项：**
- 全局安装路径可通过 `npm config get prefix` 查看
- 安装后 `mafw` 命令在 PATH 中，如果 shell 找不到请刷新 PATH（新开终端或重启 shell）
- `.npm-global` 路径下的文件名为 `mafw`（无后缀）、`mafw.cmd`、`mafw.ps1`，对应不同 shell

Desktop 构建需要先 `cd opencode-dev/packages/desktop && npm install`（workspace 解析 `@mafw/sdk` 到 `packages/gateway-sdk/`）。

### 6.5 HTTP 路由注意事项
Gateway API 路由使用正则匹配，query string 会导致 `$` 锚定不匹配：
- 正确：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)`
- 错误：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages$/)`（不匹配 `?limit=100`）

## 7. LongMemEval 记忆基准（evaluation/longmemeval/）

基于 LongMemEval (arXiv:2410.10813, ICLR 2025) S 集（500 题，6 类，~50 haystack sessions/题）的谐波记忆质量评测。TS runner 直接 import gateway 类，`fs.mkdtempSync` 隔离 HarmonicUnitFileStore，**不污染**真实 `~/.mafw`，不需启动 gateway 实例。

**两层**：
- **L1 检索层**：`ingest` 灌入 → `HarmonicIndexManager.search(question, k)` → `recall@k / ndcg@k`（per-session 对 `answer_session_ids`）
- **L2 阅读层**：L1 top-k 记忆 + reader LLM → judge LLM（per-type prompt，0/1）

**关键发现（baseline，48 题子集，session 粒度，frozen energy）**：
- Phase 2：总体 R@10 = 47.4% → **94.9%**（bm25 检索器）；R@5 = 28.1% → 93.2%；R@1 = 5.8% → **58.6%**
- **session 粒度优于 round**（0.474 vs 0.277）
- L2 QA accuracy：token+openrouter 基线 16.7% → bm25+mimo-v2.5(xiaomi) **58.3%**；Phase Q 加来源标记/排序 ablation 后进一步到 **64.6% (date order) / 66.7% (rank order)**
- multi-session / preference 仍是短板（0.375），需 Phase M 语义层
- 生产默认检索器已切为 **bm25**（Phase R），`token` 仍可通过 `MAFW_SEARCH_RETRIEVER=token` 回退

**设计决定（README 也写了）**：
- 能量默认冻结 0.8（保可复现），`realistic` 模式以 `question_date` 为基准算 0.005/天衰减
- 摄入时 haystack 全文入 `primary_abstraction`，对应"检索器只看 primary_abstraction + cue_anchors" 的事实
- judge prompts 是近似移植（GitHub / HF 直连不通，未拉取官方版），下次获取官方 prompts 请替换 `evaluation/longmemeval/src/judge-prompts.ts`

**运行**（详见 `evaluation/README.md`）：
```bash
# 数据下载（需 hf-mirror.com 可访问）
curl -L -o evaluation/longmemeval/data/longmemeval_s.json \
  https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

# L1 检索层
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session

# L2 阅读层（reader + judge）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l2-qa.ts \
  --l1Run evaluation/longmemeval/results/<ts>/l1-run.jsonl \
  --reader meta-llama/llama-3.1-8b-instruct \
  --judge meta-llama/llama-3.1-70b-instruct \
  --apiUrl https://openrouter.ai/api/v1/chat/completions \
  --apiKeyProvider openrouter
```

## 8. Usage Provider Plugin System

### 8.1 架构概述

所有 8 个内置适配器已重构为 JS 插件（commit c2faeef4），采用双目录加载机制：
- **内置插件**：`dist/usage/builtin-plugins/`（随包分发）
- **用户插件**：`~/.mafw/usage-plugins/`（用户同名文件覆盖内置）

Gateway 仅提供 PluginLoader + ctx + UsagePoller；UI 保持通用。

### 8.2 插件类型

| 类型 | 适配器 | 窗口类型 |
|------|--------|----------|
| `api` | deepseek, kimi, openrouter, siliconflow-cn | balance（余额/限额）|
| `token-plan` | opencode-go, zhipuai-coding-plan, kimi-for-coding, commandcode | 5h / 7d / month |

### 8.3 插件接口

```javascript
module.exports = {
  name: 'my-provider',
  type: 'api' | 'token-plan',
  plan: 'Plan Name',
  async fetch(ctx) {
    // ctx.apiKey(name) - 读取 auth.json 中的 provider key
    // ctx.cookie(name) - 读取 config.usage.cookies[name]
    // ctx.fetch(url, opts) - 带 10s 超时的 fetch
    // ctx.pluginConfig(name) - 读取 config.usage.pluginConfig[name]
    // ctx.log - gateway logger
    return {
      name: 'my-provider',
      type: 'api',
      plan: 'Plan Name',
      windows: [{ window: 'balance', used, limit, unit: '$', pct }],
    };
  },
};
```

### 8.4 特定适配器实现细节

#### KimiCodingPlanAdapter（kimi-for-coding）

**Bug 修复**（commit 69bfebf6）：
- 旧实现：所有 limit items 硬编码 `window:'5h'`
- 新实现：映射 `window.duration`（分钟）→ 窗口类型
  ```javascript
  const durationToWindow = { 300: '5h', 10080: '7d', 43200: 'month' };
  ```
- 回退：未匹配的 duration 默认 `'5h'`
- 月度窗口：当 `limits[]` 中无月度限制时，从 `root.usage.{limit,used}` 添加月度窗口

#### CommandCodeAdapter（commandcode）

**API 结构**（https://api.commandcode.ai/internal/billing/credits）：
- `body.windowLimits`（顶层，非 `body.credits.windowLimits`）：`fiveHour`/`weekly` 含 `cap`+`used`+`resetAt`
- `body.credits.monthlyCredits`：月度剩余（无硬性上限）

**月度窗口实现**：
```javascript
windows.push({
  window: 'month',
  used: monthlyCredits,
  limit: 0,      // 无硬性上限
  unit: '$',
  pct: 0,        // 显示为无限样式
});
```

### 8.5 配置

```yaml
usage:
  disabledPlugins: []  # 禁用的插件名称列表
  cookies: {}          # session cookies（如 commandcode）
  pluginConfig: {}     # 插件自定义配置
```
