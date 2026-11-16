# 两层记忆分离：海马体 episodic / 皮层 knowledge

> 日期：2026-11-16 · 状态：设计待审（已过 builder check，问题已修）
> 范围：T1 episode 化 + Harmonic 去 episodic + 召回/UI 分层 + T1 dense 决策
> 取代：`2026-09-23-memory-dual-system-restructure-design.md` §3.2「快层 = t1_archive + type:episodic」与 Phase C4 的 episodic 通道部分
> 相关：`docs/research/2026-11-16-episode-boundary-research.md`、`docs/releases/2026-11-16-t1-sparse-episode-code.md`、`docs/architecture/memory.md`

## 1. 为什么

用户目标：**整体记忆更像大脑，并且区分清楚海马体与皮层记忆**。

当前问题不是“检索通道不够多”，而是两层职责在行为上混在一起：

- Harmonic 同时存 `semantic` / `procedural` / `episodic`，`episodic` 是叙事；
- T1 有 raw trace、feature、actor、concept、sparse code，但没有 episode 边界，回答不了“一段事情”；
- 召回把两层塞进一个结果面：`layer=gist|t1|both`，`fused` 分数混排；
- reflection 依赖 Harmonic 的 `episodic` 作为输入，皮层反过来承担海马体工作；
- T1 仍把 dense 当作与稀疏通道平权的语义兜底。

目标契约：

| | 海马体（T1） | 皮层（Harmonic） |
|---|---|---|
| 回答 | “哪一次 / 发生了什么” | “这意味着什么 / 以后怎么做” |
| 内容 | raw trace + episode index + sparse code | semantic / procedural / global |
| 写入 | 快、append-only、不泛化 | 慢、由固化管线产生 |
| 检索 | 稀疏线索 + pattern completion | 语义 / 图 / 锚点 |
| 不做什么 | 不写 gist、不做语义泛化 | 不存原始对话、不存 episode 叙事 |

## 2. 目标 / 非目标 / 反目标

**目标**

1. T1 拥有 episode：边界声明 + 推断、`t1_episodes`、episode 检索、`t1ep:` 指针。
2. Harmonic 不再新增 `episodic`；只写 semantic / procedural / global。
3. 召回分开展示 episode 与 knowledge，不再混成一个 fused 列表。
4. 桌面 Memory 页分 Episodes / Knowledge；引用能区分“哪一次”与“哪条知识”。
5. 存量 `episodic` 保留但默认不参与皮层召回；不物理删除。
6. T1 dense 降为 `on | shadow | off`，默认 `shadow`，由 baseline 决定去留；`semanticAtoms` 独立开关。

**非目标**

- 不模拟 PFC / 工作记忆 / 情绪 / 神经调质。
- 不重写 raw T1；不做全量 T1 dump。
- 不做 project / session 隔离，不做多租户。
- 本周期不做 LLM 边界分段。
- 不删除存量记忆（soft supersede 是硬不变量）。

**反目标（即使能跑也算失败）**

- T1 仍靠 dense cosine 做主要语义召回。
- Harmonic 继续写“谁做了什么”的叙事。
- 召回把 episode 和 knowledge 混成一个分数。
- 为了分层让“上次我们做了什么”查不到。
- 边界切得比 turn 还碎，或一个 episode 跨几十个任务。

## 3. 当前代码事实

### 3.1 T1

- `t1_observations` / `t1_archive` / `t1_turns`：raw trace + 逻辑 turn。
- `t1_turn_features` / `t1_feature_fts`：intent/action/tool/target/result/error/decision/entities/outcome。
- `t1_actors` / `t1_turn_actors`；`t1_concepts` / `t1_turn_concepts`；`t1_sparse_terms`；`t1_turn_encoding`。
- 检索：`createGatewayT1Search` → dense + `t1_fts` + feature + concept + actor + sparse + 1-hop neighbors。
- `readSessionTimeline` / `buildReplayBlock` 已能按 turn 顺序回放 active + archive。
- 没有 `t1_episodes`；`topic-segmentation.ts` 只做 shadow log / prompt 输入。

### 3.2 Harmonic

- `HarmonicUnit.type`：`episodic | semantic | procedural | global`。
- turnCompress（每小时）让 worker agent 自主 `mafw_add_memory`，prompt 明确允许 episodic 叙事。
- reflection 读取“未反思的 episodic”作为输入。
- `sessionContext` 读取本会话旧 episodic 的 primary_abstraction。
- `channel-split` 对 episodic 通道降权；`priorKnowledgeFor` 排除 episodic。
- Memory 页按 `unit.type` 显示标签；`mafw_add_memory` schema 接受 `episodic`。

### 3.3 召回

- `mafw_search_hybrid` / `GET /api/memory/search` 支持 `layer=gist|t1|both`，默认 `gist`。
- 同步 `/api/recall/context` 有 100ms 硬契约，当前 Harmonic-only；异步快照可融合 T1。
- `layer=t1` 返回 turn 级 `t1Results`；T1-only 快照可用。
- `mafw_get_memory("t1:<traceId>")` 返回 trace 原文；没有 episode 指针。
- SDK `memory.searchLayered` 返回 `{layer, results, t1Results}`。

## 4. 目标模型

### 4.1 Episode = 索引，不是故事

```ts
interface T1Episode {
  episodeId: string;          // t1ep_<sha1(sessionId + ':' + startTurn).slice(0,20)>
  sessionId: string;
  startTurn: number;
  endTurn: number;            // 可变：开放 episode 随 turn 增长
  status: 'open' | 'closed';
  startedAt: number | null;
  endedAt: number | null;
  goalId?: string;
  boundarySource: 'declared' | 'inferred' | 'session_end' | 'max_length';
  boundaryReason:
    | 'user_declared'
    | 'agent_declared'
    | 'actor_shift'
    | 'topic_shift'
    | 'intent_shift'
    | 'idle_timeout'
    | 'session_deleted'
    | 'max_length';
  confidence: number;         // 0..1
  intent?: string;            // 首 turn feature.intent（派生，非叙事）
  outcome?: string;           // 末 turn feature.result/decision 或 goal verdict
  actors: T1TurnActor[];      // 去重后的 episode 参与者
  conceptIds: string[];
  sourceTraceIds: string[];
}
```

不存 `summary` / `narrative`。内容靠 `t1_episode_members` + trace 还原。

### 4.2 数据表

```sql
CREATE TABLE t1_episode_boundaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  after_turn INTEGER NOT NULL,   -- canonical edge: turn N 属于旧，N+1 属于新；0 = 首 turn 之前
  source TEXT NOT NULL,          -- agent | user | system
  reason TEXT,
  intent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(session_id, after_turn, source)
);
CREATE INDEX idx_t1_episode_boundaries_session
  ON t1_episode_boundaries(session_id, after_turn);

CREATE TABLE t1_episodes (
  episode_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | closed
  started_at INTEGER,
  ended_at INTEGER,
  goal_id TEXT,
  boundary_source TEXT NOT NULL,
  boundary_reason TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  intent TEXT,
  outcome TEXT,
  actors_json TEXT,
  concept_ids_json TEXT,
  source_trace_ids_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_t1_episodes_session ON t1_episodes(session_id, start_turn);
CREATE INDEX idx_t1_episodes_time ON t1_episodes(started_at);
CREATE INDEX idx_t1_episodes_status ON t1_episodes(status, ended_at);

CREATE TABLE t1_episode_members (
  episode_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL,
  PRIMARY KEY (episode_id, trace_id)
);
CREATE INDEX idx_t1_episode_members_trace ON t1_episode_members(trace_id);
```

全部派生/可重建；session 级重建在一个事务里 `DELETE + INSERT`。

### 4.3 Episode ID 稳定性

- ID 只由 `sessionId + startTurn` 决定，**不包含 endTurn**：开放 episode 增长时 ID 不变。
- 如果推断/声明改变导致 startTurn 变化，旧 episode 退役、新 episode 新 ID；不做跨分割的 ID 迁移。
- `mafw_add_memory` 不接收 `episodeId`；服务端根据 `sourceTraceIds` 反查 `t1_episode_members` 派生，查不到就省略。记忆里的 episodeId 是软提示，不作为真值。
- reflection 游标按 `(sessionId, last_end_turn)`，不按 episode ID。

## 5. 边界

### 5.1 Canonical 形式

数据库只存 **`after_turn`**：turn `N` 属于旧 episode，`N+1` 属于新 episode。没有 `position` 二义性。

工具/HTTP 输入：

```ts
{
  scope?: 'start_new' | 'end_current';  // default start_new
  afterTurn?: number;                   // 显式锚点，优先于 scope
  reason?: string;
  intent?: string;
}
```

- `scope='start_new'`：当前 turn 开始新 episode → `after_turn = currentTurn - 1`
- `scope='end_current'`：当前 turn 结束旧 episode → `after_turn = currentTurn`
- 显式 `afterTurn` 直接使用
- `currentTurn` 由 gateway 解析（session 当前最大 turn_seq）
- 声明永远压过推断；重复声明按 `UNIQUE(session_id, after_turn, source)` 去重

### 5.2 `/new-episode` 用户命令

不能用“命令执行时 current max”解析，会与 fire-and-forget 的 capture 竞态。

实现：命令只写一个 **pending flag** 到 `kv_store`（scope `episode-boundary-pending`，key=sessionID）。下一次 `/api/obs/capture` 收到 `user_input` 并分配新 turn `N` 时：

- 写入 boundary `after_turn = N - 1`，`source='user'`，`reason='user_declared'`
- 清掉 pending flag

无新 turn 时 flag 一直等待；不回溯旧 turn。

### 5.3 推断兜底

只在 **user turn** 评估；tool/assistant turn 不单独切。

按顺序：

1. **actor_shift**：`specificActors = actors - user:local`；当前 user turn 的 specific actor 集合与 episode profile 交集为空，且两边非空。
2. **topic_shift**：`concepts ∪ entities` 与 episode profile 交集为空，且两边非空。
3. **intent_shift**：双方 `sem:` atoms 非空且交集为空，且 intent token Jaccard < 0.15；仅当 actor/topic 都没触发时使用；新 user intent 至少 3 个 token 或 8 字符。
4. **结构/时间只加置信度**：goal_id 变化、目录切换、tool failure、gap > 2h 各 +0.1；不单独触发。
5. **max_length**：episode > 30 turns 强制封口。
6. **idle/timeout**：session 最后一个 turn 距 now ≥ 6h，关闭 tail episode（`session_end` / `idle_timeout`）。
7. **session deleted**：关闭全部 open episode（`session_end` / `session_deleted`）。

判定：

```text
boundary = declared
        || (isUserTurn && (actorShift || topicShift || intentShift))
        || episodeLength >= maxTurns
        || idleClosed
        || sessionDeleted
```

`confidence`：

- declared = 1.0
- actorShift = 0.8
- topicShift = 0.7
- intentShift = 0.6
- 结构/时间加分后 clamp 0.95

profile 取 episode 内已加入 turn 的并集（specific actors / concepts / entities / sem atoms），不是只比上一 turn。

### 5.4 为什么不做纯时间/纯 TCM

调研结论见 `docs/research/2026-11-16-episode-boundary-research.md`：

- 人类边界是多维事件模型（time/space/entity/causality/goal），不是时钟；
- 机械 test-event 规则在 agent 轨迹上不优于随机；
- 纯词面 TCM 对 paraphrase 和中文单字不稳；
- 声明边界在 agent 轨迹上最可靠，成本约 0.57% transcript。

## 6. 写入路径

```text
POST /api/obs/capture
  → raw T1（不变）
  → pending episode flag? 写 boundary(after_turn = newTurn - 1)
  → t1Indexer（dense，可 shadow/off）

TurnPipeline.runSession
  → per-turn feature/actor/concept/sparse（已有）
  → rebuildSessionEpisodes(sessionID)
       read t1_turns + features + actors + concepts + sparse + boundaries
       walk turns → episodes（open/closed）
       DELETE/INSERT t1_episodes + members（事务）
  → archiveTurn（不变）
```

`rebuildSessionEpisodes` 幂等；失败 fail-open，raw T1 不受影响。
`backfillT1Episodes({ limit, sinceDays })` 按 session 分页重建。

配置：

```ts
recall.t1Episodes = {
  enabled: boolean;          // default true
  mode: 'off' | 'shadow' | 'live';  // default shadow
  maxTurns: number;          // default 30
  idleCloseMs: number;       // default 6h
  timeGapWeakMs: number;     // default 2h
  inferOnUserTurnOnly: true; // 固定 true
}
recall.t1Recall = {
  denseIndex: 'on' | 'shadow' | 'off';  // default shadow
  semanticAtoms: 'on' | 'off';          // default on
}
```

`shadow`：写 episode，但 agent 自动召回不消费 episode；`layer=episodes` 可用于观察/评测。
`live`：episode 进入 agent 自动召回。

### 6.1 启动回填与 idle close

- gateway 启动后（数据库迁移完成），后台低优先级 `backfillT1Episodes({ limit: 1000, sinceDays: 90 })`。
- 每日 `memory:decay` 调用 `closeIdleEpisodes({ idleMs })` + 继续 bounded backfill。
- heartbeat 记录 `episodesRebuilt` / `episodeRebuildFailed` / `episodesClosedIdle`。
- Episodes UI 不依赖回填完成：先显示已有 episode，再增量刷新。

## 7. 固化：T1 → Harmonic

### 7.1 turnCompress 不再写 episodic

`TOOL_EXTRACTION_SYSTEM` 改：

- 删除 `episodic` 类型与“task narratives”指令；
- 明确：“episodes already live in T1; do not restate what happened”；
- 只写 semantic（事实/偏好/约束/决定）与 procedural（教训/模式）；
- 每条仍带 `sourceTraceIds`；`episodeId` 由服务端从 trace 派生，不让 worker 填。

### 7.2 reflection 改吃 episode

- 输入：`t1_episodes` 中 **closed**、`end_turn - start_turn + 1 >= 2`、非 internal session、`ended_at` 在 `reflection.lookbackDays`（默认 30 天）内、且未反思的 episode。
- 增量游标：`kv_store` scope `reflect-episode-cursor`，key=sessionID，value=`last_end_turn`。
- 单次上限：`reflection.maxEpisodesPerRun`（默认 10），与旧 `maxEpisodicPerReflect` 对齐。
- 输入内容：episode intent/outcome/actors + 有界成员 trace（复用 raw-T1 replay collector），不读 Harmonic episodic。
- 产出：semantic / procedural insights，`source_trace_ids` 校验为本次注入的 trace。
- 失败回退：开关 `reflection.input='episodes'|'legacy-episodic'`，默认 episodes；回退不中断。

### 7.3 sessionContext

- 改用 `t1_episodes` 的 recent `intent` 列表（同 session），而不是 Harmonic episodic 的 primary_abstraction。
- 预算不变（默认 10 条）。

### 7.4 `mafw_add_memory`

- 新 schema：`semantic | procedural | global`。
- 兼容：HTTP/MCP 收到 `episodic` 时 **coerce 为 semantic**，响应带 `warnings: ['episodic is retired; stored as semantic gist']`；native tool schema 不暴露 `episodic`。
- 一个 release 后移除 coerce。
- 服务端根据 `sourceTraceIds` 反查 `t1_episode_members`，把 `episodeId` 写进记忆 metadata（可选）。

### 7.5 存量 episodic

- 不删除、不改文件。
- 默认皮层 **search/recall** 过滤 `type='episodic'`；pinned/sticky 例外（用户显式置顶则保留，标 `legacy`）。
- `mafw_get_memory(id)` 仍可直取，返回 `legacyEpisodic: true`。
- consolidation 输入排除 legacy episodic（避免继续生成新皮层记忆）；decay/energy 维护照常，不丢数据。
- `channel-split` 仅对 legacy 生效；无 legacy 结果时是 no-op。
- 本周期不做 LLM 转写；后续单独 spec。

## 8. 召回

### 8.1 分层结果，不混排

```ts
interface EpisodeHit {
  episodeId: string;
  sessionId: string;
  startTurn: number;
  endTurn: number;
  status: 'open' | 'closed';
  startedAt: number | null;
  intent?: string;
  outcome?: string;
  actors: string[];
  conceptIds: string[];
  score: number;
  sources: Array<'turn' | 'actor' | 'concept' | 'sparse' | 'declared'>;
  topTraceIds: string[];
}

interface LayeredRecall {
  episodes: EpisodeHit[];
  memories: MemoryUnit[];
  legacyEpisodic?: MemoryUnit[];
}
```

- `GET /api/memory/search` 保留 `layer=gist|t1|both`；新增 `layer=episodes|auto`。
  - `auto`：episodes + memories 分区；**只在 `t1Episodes.mode='live'` 时返回 episodes**，shadow 时 episodes 为空、T1 仍走 turn 级兼容。
  - `gist`：只返回 memories（不含 legacy episodic）。
  - `t1`：只返回 turn 级 `t1Results`（兼容）。
  - `episodes`：只返回 episode 分组；shadow 也可用于评测。
- `mafw_search_hybrid`：默认仍 `gist`；新增 `layer=auto|episodes`；描述明确“episodes = 发生过什么，memories = 意味着什么”。
- `mafw_get_memory("t1ep:<episodeId>")`：episode 元数据 + 成员 turn（≤20）+ trace id；`t1:<traceId>` 不变。

### 8.2 自动召回路径与 100ms

- 同步 `/api/recall/context` **不新增** episode 查询；保持 100ms 契约，继续 Harmonic-only。
- agent 自动召回的 episode 段来自**异步快照**：快照构建时调用 `layer=auto`，把 episodes/memories 两段写进 snapshot；turn-start 直接读 snapshot。
- 无 snapshot 时同步路径只给 knowledge，不给 episode；不阻塞。
- 显式 `mafw_search_hybrid(layer=auto|episodes)` 走在线检索，不受 100ms 约束。

### 8.3 Episode 检索

1. 用现有 turn 通道（FTS/feature/concept/actor/sparse）取候选 turn；
2. 映射到 `t1_episode_members`；
3. 按 episode 聚合：`score = Σ top turn scores + actor/concept overlap + declared bonus`；
4. 返回 episode + top 3 traces；
5. 无 episode（旧数据/未编码）回退 turn 级 T1。

不做 episode 与 memory 的 RRF 混排。

### 8.4 Agent 召回块

```text
## Episodes — what happened
[t1ep:...] 2026-11-16 · reviewer,builder · intent ... （3 turns）

## Knowledge — what it means
[mem-...] ...（semantic/procedural）
```

指针：

- 原文 → `mafw_get_memory("t1ep:<id>")` 或 `t1:<traceId>`
- 知识全文 → `mafw_get_memory("<memoryId>")`

## 9. UI

桌面优先；mobile/TUI 后续。

### 9.1 Memory 页

- 两个 tab / 分段：**Episodes**（T1）与 **Knowledge**（Harmonic）
- Episodes 默认列表走 `GET /api/memory/episodes?limit=50`（空 query 也能浏览）；搜索走 `layer=episodes`
- 卡片：时间、actors、intent/outcome、turn 数、boundary source（declared/inferred）
- 点击 episode → 成员 turn 时间线（复用 session timeline 组件）
- Knowledge：保留 semantic/procedural 标签；`legacy episode` 单独灰色标签，默认不显示
- 搜索框共用 query

### 9.2 其他面

- Chat recall 引用：`episode` vs `knowledge` 徽标
- Tool card `mafw_get_memory("t1ep:...")` 显示 episode 头 + turn 列表
- 不新增裸 `<button>` / 裸 `title`；用 `@mafw/ui` v2；主题 token 不硬编码

### 9.3 Episodes API

```text
GET /api/memory/episodes?limit=50&cursor=<startedAt|episodeId>&sessionId=&since=
→ { episodes: EpisodeHit[], nextCursor?: string }
```

SDK `memory.episodes({...})`；desktop preload/IPC `memory.episodes`。

## 10. T1 dense 决策

`denseIndex` 与 `semanticAtoms` **独立**：

| 配置 | 作用 | 默认 |
|---|---|---|
| `t1Recall.denseIndex` | 只控制 `t1_vectors` dense cosine 通道 | `shadow` |
| `t1Recall.semanticAtoms` | 控制 `T1SemanticEncoder` 的 `sem:` atoms | `on` |

- `denseIndex=off` **不关闭** semantic atoms；只要 embedding runtime 在，atoms 继续产出。
- `denseIndex=shadow`：计算 dense、记录 would-rank，不参与 fused。
- `denseIndex=off`：不计算 dense，不依赖 `t1_vectors`。
- A/B 矩阵：dense on/shadow/off × atoms on/off；主比较保持 atoms on，避免混淆。
- `intent_shift` 在 atoms off 时退回 token Jaccard。

判定门槛（evaluation/t1）：

- 新增 episode-level queries（“上次那个 plan 后来怎么定的”“reviewer 和 builder 那次争论”）
- 比较 FTS/feature/concept/actor/sparse/fused（无 dense）vs 现状
- 若 fused 无 dense 的 recall@3 下降 ≤2%，且 episode 查询不降 → 默认 `off`
- 否则保持 `shadow`，继续观察

Harmonic 的 dense 不受影响。

## 11. 迁移与回滚

| 项 | 策略 |
|---|---|
| 存量 `episodic` | 保留文件；默认 search/recall 过滤；pinned/sticky 例外；`includeLegacyEpisodic` 可回读 |
| `mafw_add_memory` episodic | 一个 release 内 coerce → semantic + warning；之后拒绝 |
| 旧 `layer=gist` | 行为不变，但过滤 legacy episodic |
| 旧 `t1Results` | 字段保留；新增 `episodeId?` 可选 |
| episode rebuild | 派生表，可删除重建 |
| 开关 | `t1Episodes.mode`；`denseIndex`；`semanticAtoms`；`includeLegacyEpisodic`；`reflection.input` |
| 回滚 | 每 phase 独立 flag；不删除 raw T1 / 存量记忆 |

## 12. 可观测性

`/api/memory/stats` 新增：

```ts
t1: {
  episodes: {
    count: number;
    open: number;
    closed: number;
    avgTurns: number;
    declared: number;
    inferred: number;
    maxLength: number;
    lastRebuildAt: string | null;
  };
  boundaries: { declared: number; inferredCandidates: number };
  denseIndex: 'on' | 'shadow' | 'off';
  semanticAtoms: 'on' | 'off';
};
cortex: {
  types: { semantic: number; procedural: number; global: number };
  legacyEpisodic: number;
  legacyEpisodicFiltered: number;
};
```

heartbeat：`episodesRebuilt` / `episodeRebuildFailed` / `episodesClosedIdle` / `legacyEpisodicFiltered`。
shadow 日志：候选边界 reason/confidence/profile 交集 → `~/.mafw/logs/episode-boundary-shadow.jsonl`。

## 13. 测试

**TDD，先失败测试。**

- 边界纯函数：canonical `after_turn`、`start_new/end_current`、pending flag、declared 优先、user-turn only、actor/topic/intent、max length、idle close、session deleted、置信度、profile 并集。
- DB：boundary/episode/members roundtrip；session 重建幂等；ID 只依赖 startTurn；members 顺序；`t1ep:` 读取；status open/closed。
- TurnPipeline：per-turn encode 后写 episode；失败 fail-open；shadow 不让 `auto` 消费 episode。
- 固化：turnCompress prompt 不含 episodic；`mafw_add_memory` coerce + warning；reflection 只吃 closed/≥2 turns/非 internal/30 天/游标。
- 召回：`layer=auto|episodes|gist|t1|both` 形状；episodes/memories 分区；legacy 过滤；pinned/sticky 例外；`includeLegacyEpisodic`；`t1ep:`。
- 同步 100ms：`/api/recall/context` 不新增 episode 查询。
- UI：Memory 页两个 tab；Episodes 空 query 列表；episode 卡片/详情；legacy 标签；desktop 测试带 `--conditions=browser`。
- 评测：episode recall@k、boundary F1/Pk/WindowDiff、no-answer；dense × atoms A/B。
- 全量：gateway 全量 + desktop 测试 + tsc + build。

## 14. 分阶段落地

| Phase | 内容 | 行为变化 | 回滚 |
|---|---|---|---|
| 1 | `t1_episode_boundaries` / `t1_episodes` / members + rebuild + shadow + boot backfill | 无（只写派生表） | `t1Episodes.mode=off` |
| 2 | native 声明 tool + pending flag + 推断 + idle close + shadow 日志 | agent 可主动切；召回不变 | 删除 flag |
| 3 | episode 检索 + `t1ep:` + `layer=episodes` + Episodes API | 新增结果面 | `layer` 默认不变 |
| 4 | 桌面 Memory 页 Episodes/Knowledge + 引用标签 | UI 新增 | UI feature flag |
| 5 | reflection/sessionContext 改 episode；turnCompress 停 episodic；add-memory schema | 固化行为变化 | `reflection.input` / 旧 prompt flag |
| 6 | legacy episodic 默认过滤；dense shadow/off；stats | 皮层召回变化 | `includeLegacyEpisodic` / `denseIndex=on` |

Phase 1–2 可先合；3–4 增量；5 风险最高，必须有旧路径回退；6 由 baseline 决定。

## 15. 风险

| 风险 | 缓解 |
|---|---|
| 推断过度切分 | 只在 user turn；declared 优先；shadow 校准；max 30 |
| 漏切（agent 自主换任务） | native 声明 tool + prompt 约束；后续可加 goal 断点 |
| `/new-episode` 竞态 | pending flag 绑定下一个 user turn，不解析 current max |
| episode ID 漂移 | ID 只含 sessionId+startTurn；记忆里的 episodeId 由 trace 派生、软提示 |
| reflection 质量下降 | `reflection.input` 双路；先 A/B 再切换 |
| “上次做了什么”查不到 | episode 检索 + `t1ep:` + 回退 turn 级；sync 路径不阻塞 |
| legacy 存量丢失 | 不删除；默认过滤可回读；pinned/sticky 例外 |
| dense 关掉后召回下降 | denseIndex 与 semanticAtoms 独立；baseline 门槛；一键回 on |
| UI 破坏现有 Memory 页 | 新 tab 增量；Knowledge 默认视图保留 |
| episode 重建开销 | 按 session、限 5000 turns、失败 fail-open |
| MCP 无 caller session | native tool 优先；MCP 本周期不暴露或要求显式 sessionID |

## 16. 我替用户做的调用（可推翻）

1. canonical 边界是 `after_turn`；tool 用 `scope=start_new|end_current` 解析，默认 `start_new`。
2. `/new-episode` 用 pending flag 绑定下一个 user turn，不在命令时解析 current max。
3. episode ID 只由 `sessionId + startTurn` 决定；`endTurn` 可变。
4. `session_end` = session deleted 或 idle ≥ 6h；reflection 只吃 closed。
5. inference 包含 `intent_shift` 触发（不是只加置信度），但要求 actor/topic 未触发。
6. 推断只在 user turn；max 30 turns；2h 只做弱先验。
7. `episodic` 先 coerce 为 semantic 一个 release，不直接拒绝。
8. 存量 episodic 本周期只过滤/不转写；pinned/sticky 例外。
9. `layer=auto` 只用于异步快照和显式搜索，不进同步 100ms 路径。
10. `denseIndex` 与 `semanticAtoms` 独立；dense 默认 shadow，atoms 默认 on。
11. MCP 本周期不暴露 boundary tool；native tool 优先。
12. Episodes 页用 `GET /api/memory/episodes` 列表接口，空 query 可浏览。
13. 启动后台回填 90 天/1000 条，nightly 继续 bounded backfill。

## 17. Builder check 问题与处理

| # | 问题 | 处理 |
|---|---|---|
| 1 | 边界锚点/竞态 | 改为 canonical `after_turn`；tool 用 scope；`/new-episode` 用 pending flag |
| 2 | episode ID 稳定性 | ID 只含 sessionId+startTurn；endTurn 可变；记忆 episodeId 由 trace 派生 |
| 3 | session_end 触发 | session deleted 或 idle ≥6h；`closeIdleEpisodes`；closed 才可反思 |
| 4 | `layer=auto` 路径/100ms | auto 只用于异步快照与显式搜索；同步路径不查 episode；shadow 不消费 |
| 5 | intent_shift 是否触发 | 是触发项，但需 actor/topic 未触发 + sem/token 条件 |
| 6 | reflection 范围/回填 | closed + ≥2 turns + 非 internal + 30 天 + 游标 + 单次 10 |
| 7 | legacy 过滤范围 | search/recall + consolidation 输入过滤；直取/pinned/sticky 例外 |
| 8 | dense off 是否关 atoms | 独立开关；off 只关 dense，atoms 继续 |
| 9 | MCP caller session | native tool 优先；MCP 本周期不做 |
| 10 | Episodes 浏览/回填 | 新增 list API；启动 90 天/1000 条回填 + nightly |
