# 2026-11-16 · 两层记忆分离（海马体 T1 / 皮层 Harmonic）

- **分支**：`feat/t1-sparse-first`
- **范围**：T1 episode 化 + Harmonic 去 episodic + 召回/UI 分层 + T1 dense 决策
- **Spec**：`docs/superpowers/specs/2026-11-16-two-layer-memory-separation-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-16-two-layer-memory-separation.md`

## 目标

“发生过什么”只由 T1 episode + trace 回答；“这意味着什么 / 以后怎么做”只由 Harmonic semantic/procedural 回答。两层不再混在一个 fused 结果里。

## 交付内容

### T1 episode

- `t1_episode_boundaries`：append-only，canonical `after_turn`（turn N 属于旧，N+1 属于新）
- `t1_episodes`：边界、status、派生 intent/outcome、actors、concepts、`source_trace_ids`；不写叙事
- `t1_episode_members`：episode ↔ trace
- ID 只由 `sessionId + startTurn` 决定：开放 episode 增长时 ID 不变
- session 级重建幂等；boot 回填 90 天/1000 条；nightly `memory:decay` 继续 bounded backfill + idle close（6h）

### 边界

- 声明优先：native `mafw_mark_episode_boundary`（`start_new` / `end_current`）+ `/new-episode`（pending flag 绑定下一个 user turn）
- 推断只在 user turn：specific actor 全换 / concept+entity 无交集 / intent atoms 漂移
- 结构/时间只加置信度；max 30 turns；session deleted 或 idle 6h 封口
- shadow 模式写 `episode-boundary-shadow.jsonl`，默认不改变召回

### 召回 / API / UI

- `layer=episodes|auto`；`auto` 只在 `t1Episodes.mode='live'` 时包含 episodes
- `GET /api/memory/episodes` 列表 + `GET /api/memory/episodes/:id` 详情
- `mafw_get_memory("t1ep:<id>")` 返回 episode + 成员 turn（≤20）
- 异步快照按 `## Episodes` + `## Knowledge` 两段渲染；同步 `/api/recall/context` 不查 episode，守住 100ms
- 桌面 Memory 页：Episodes / Knowledge 两个 tab；Episodes 空 query 可浏览；搜索走 `searchEpisodes`
- 搜索 tool card 在 knowledge 前显示 episode 行；legacy episodic 标 `legacy`

### 皮层

- turnCompress prompt 不再写 episodic，明确“episodes already live in T1”
- `mafw_add_memory`：native/MCP schema 只留 semantic/procedural/global；HTTP/MCP 收到 episodic 先 coerce 为 semantic + warning
- `episode_id` 由服务端从 `sourceTraceIds[0]` 反查，客户端传入的忽略
- reflection 改吃 closed/≥2 turns/非 internal/30 天内的 episode；`reflectionInput='legacy-episodic'` 可回滚
- sessionContext 改读 episode intent；无 episode 时才回退旧 episodic
- 默认 Harmonic search/recall 过滤 legacy `episodic`（pinned/sticky 例外；`includeLegacyEpisodic=true` 可回读）

### T1 dense

- `t1Recall.denseIndex='on'|'shadow'|'off'`，默认 `shadow`（计算但不融入 fused）
- `t1Recall.semanticAtoms='on'|'off'` 独立；`denseIndex=off` 不关闭 atoms
- `/api/memory/stats.t1` 暴露 `denseIndex {mode,evaluations,withDenseHits}` 与 `semanticAtoms`

## Baseline（fixtureVersion 3，16 cases）

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.625 | 0.563 | 1.00 |
| dense | 0.625 | 0.594 | 1.00 |
| feature | 0.625 | 0.563 | 1.00 |
| concept | 0.938 | 0.938 | 1.00 |
| actor | 0.188 | 0.188 | 1.00 |
| sparse | 0.938 | 0.875 | 1.00 |
| episodes | 0.938 | 0.938 | 1.00 |
| fused | 0.938 | 0.938 | 1.00 |

- 新增 episode 查询 `q-episode-deploy` / `q-episode-cn` 都命中 deploy-plan episode
- 唯一 fused/episode miss 是 `q-parse-holdout`（`解码失败`）：不在 alias、原文、synthetic embedding 里
- concept 的 0.938 部分仍是循环的：多数 fixture 查询本就在 seed alias 表里
- 这些数字只验证通道接线与融合，不代表真实模型质量

## 测试

新增 **61 个 gateway 测试 + 5 个 desktop 测试 + 3 个 SDK 测试**，覆盖：

- episode schema/ID/pagination/reflectable 查询
- 边界纯函数（declared/pending/user-turn/actor/topic/intent/max/idle/session-delete）
- rebuild / backfill / idle close / shadow log
- boundary endpoint + pending flag + native tool + `/new-episode`
- turn pipeline rebuild + session context
- episode search / API layers / SDK / `t1ep:` 指针
- desktop IPC + Episodes/Knowledge tab + legacy 标签
- add-memory coerce + prompt retirement + reflection episode source
- legacy episodic filter + dense/atoms independent

门禁：

```text
gateway full     974/974 suites；7799 tests（7797 passed，2 skipped，0 failed）
desktop tests    3876 tests / 736 suites，0 failed
gateway tsc      rc=0
desktop tsgo     rc=0
gateway build    rc=0
eval t1 tsc      rc=0
```

## 回滚

| 开关 | 作用 |
|---|---|
| `recall.t1Episodes.mode='off'` | 停止重建/消费 episode |
| `recall.t1Episodes.mode='shadow'` | 写 episode，不改召回 |
| `recall.reflectionInput='legacy-episodic'` | reflection 回到旧 episodic 输入 |
| `search?includeLegacyEpisodic=true` | 回读 legacy episodic |
| `recall.t1Recall.denseIndex='on'` | 恢复 dense 融合 |
| `recall.t1Recall.semanticAtoms='off'` | 停止 `sem:` atoms |

## 已知限制

- 推断边界只在 user turn；agent 自主换任务依赖声明
- 未声明且无 actor/topic/intent 变化的切换会漏切
- legacy episodic 不做 LLM 转写；只过滤/可回读
- episode ID 在 startTurn 改变时退役（重新分段会产生新 ID）
- T1 dense 默认 shadow 后，fused 不再包含 dense；是否 off 由后续真实模型 baseline 决定
- mobile/TUI 只做 API 兼容，未做 episode UI
