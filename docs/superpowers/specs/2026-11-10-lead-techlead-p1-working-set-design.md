# Lead / Tech Lead · P1：工作集与缺页

> 2026-11-10 · Phase P1
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 前置：`2026-11-10-lead-techlead-p0-kernel-objects-design.md`
> 目标：话题可以换出、按需换入；旧话题能恢复；压缩是换页，不是删除。

## 1. 背景

P0 解决了「当前话题交给 Tech Lead」和「两个入口 + 状态卡」。但 Lead 仍然只有一条长 session：
话题一多，上下文会膨胀；用户回到旧话题时，系统没有「换入」机制；compaction 仍是 runtime 的
黑盒，可能丢掉决策与未结事项。

P1 把 session 真正当虚拟内存来管：

- **工作集**：当前话题全量驻留；近期话题留摘要；冷话题在 transcript / memory 里。
- **缺页**：用户提到旧话题时，自动 recall 相关页，注入 `<recalled-topic>`，不要求用户开旧 session。
- **压缩**：按策略换出，不删除原始日志。
- **恢复**：旧话题可以切回继续；session 不在了就重建，带 provenance。

## 2. 目标 / 非目标

### 目标

- Lead 的上下文 = 当前 topic 全文 + 活跃 Goal 状态 + 近期 topic 摘要/索引 + 按需 recall。
- 用户提到旧话题 → 自动缺页召回，回答里能接上之前的结论/未结事项。
- 旧 topic 可以「切回继续」：session 在就切；不在就重建；原始 transcript 不重写。
- compaction 走确定性策略：保留决策、未结事项、最近回合；优先丢弃冗长工具输出。
- topic index 可搜索：标题、摘要、最后活跃、关联 Goal。
- 用户仍然看不到 session / compaction 选择。

### 非目标

- 不做自动话题边界（P2）。
- 不做 COW fork（P2）。
- 不做 attention scheduler（P2）。
- 不改变 Tech Lead / Builder / Reviewer 内核。
- 不做跨项目 topic 合并。

### 反目标

- 缺页召回把无关话题塞进上下文，导致串味。
- 压缩把决策/未结事项丢掉，只留泛泛摘要。
- 旧 topic 恢复时重写原始 transcript，破坏 provenance。
- 为了召回引入阻塞式 LLM 调用，拖慢首 token。

## 3. 依赖

- P0：`lead_topic`、`sourceRef`、`lead-handoff.md`、状态投影、两个入口。
- runtime `session.messages` flat history；gateway DB；memory / recall（BM25 / hybrid）。
- 现有 `session.summarize` / compaction 能力；`ContextManifest`。

## 4. 设计

### 4.1 工作集模型

```
物理内存（context window）
  ├─ 当前 topic 全文（resident）
  ├─ 活跃 Goal 状态投影
  ├─ 近期 topic 摘要（warm，最多 N 条）
  └─ 按需 recalled topic（page fault，临时驻留）
        │
        ▼
swap / 磁盘（transcript store + memory）
  ├─ 完整 topic transcript
  ├─ topic summary
  └─ 语义记忆 / 决策 / 未结事项
```

- **resident**：当前 topic；完整消息 + 工具结果摘要。
- **warm**：最近 N 个 topic（默认 5）；只保留 summary + open loops + 关键决策。
- **cold**：更早 topic；只在 recall 时换入。
- **pinned**：当前 Goal 的 source topic；不换出，直到 Goal 终态。

工作集预算：

```ts
interface WorkingSetBudget {
  maxResidentTokens: number      // 默认 60% context window
  warmTopicLimit: number         // 默认 5
  warmTopicTokens: number        // 每个 warm topic 摘要上限，默认 300 tokens
  recallMaxTopics: number        // 单次缺页最多 2 个 topic
  recallMaxTokens: number        // 单次缺页注入上限，默认 1200 tokens
}
```

### 4.2 数据模型

`lead_topic` 扩展：

| 字段 | 类型 | 说明 |
|---|---|---|
| `summary` | TEXT | topic 摘要（决策 / 未结 / 关键文件） |
| `summary_hash` | TEXT | 摘要输入 hash，防重复生成 |
| `summary_updated_at` | TEXT | 上次摘要时间 |
| `state` | TEXT | `resident` / `warm` / `cold` / `archived` |
| `last_active_at` | TEXT | 最后活跃时间 |
| `resident_tokens` | INTEGER | 估算的 resident token |
| `resumed_from` | TEXT | 恢复时指向原 topic id（可空） |

新增 `topic_message_index`（可选，按现有 DB 能力）：

| 字段 | 说明 |
|---|---|
| `topic_id` | topic |
| `message_id` | 消息 |
| `role` | user / assistant |
| `text` | 可检索文本 |
| `token_estimate` | 粗略 token |
| `created_at` | 时间 |

索引：`(topic_id, created_at)`；全文检索走现有 FTS/BM25（若可用），否则用 memory 的 hybrid 检索。

### 4.3 上下文组装（Lead）

每回合按顺序组装：

1. `<user-profile>` / pinned（现有）。
2. `<goal-status>`：活跃 Goal 投影（P0）。
3. `<topic-index>`：warm topic 的一行摘要 + open loops（最多 5 条）。
4. 当前 topic 的 resident 消息。
5. `<recalled-topic>`：本回合缺页召回的内容（临时）。
6. 用户当前消息。

预算不足时按顺序裁剪：先裁 recalled，再裁 topic-index，再对当前 topic 做工具输出截断；
决策 / 未结事项 / 用户原话不裁。

### 4.4 Page fault（缺页召回）

触发信号（任一）：

- 显式引用：「上次 / 之前 / 那个 / 继续 / 回到」+ 话题词。
- 命中原 topic 标题 / Goal 标题。
- 当前消息与某个 warm/cold topic 的 embedding 相似度超过阈值。
- 用户点击 topic index / 旧话题链接。

流程：

1. 在 `lead_topic` 里检索候选（标题 + summary + FTS/BM25 + 语义）。
2. 取 top 1–2，置信度低于阈值则**不注入**（fail-open，避免串味）。
3. 读该 topic 的 summary + 关键消息（决策 / 未结 / 用户原话），拼成 `<recalled-topic>`。
4. 注入本回合；不改变 `state`（除非用户明确要继续）。
5. 回答里标注来源 topic（可选，UI 显示「来自：<topic title>」）。

要求：

- **不阻塞首 token**：检索同步但轻量；摘要生成异步。
- **可解释**：注入内容带 topic id/title；UI 可展开。
- **可撤销**：用户说「不是这个」，下一回合不注入。

### 4.5 Compaction policy（换页）

触发：

- context 使用率 ≥ 70%。
- 当前 topic 回合数 ≥ 40。
- 用户显式「压缩」（内部命令；不作为主界面）。

策略（确定性优先）：

| 内容 | 处理 |
|---|---|
| system / pinned / Goal snapshot | 永不淘汰 |
| 当前 Goal 的 source topic | pinned，直到 Goal 终态 |
| 决策 / 未结事项 / 用户原话 | 摘要保留 |
| 最近 N 回合 | 完整保留 |
| 工具输出 | 截断到最近 10 行 / 失败日志完整保留 |
| 重复的 assistant 解释 | 合并/丢弃 |
| 已完成 topic | 换出为 warm，保留 summary |

落盘：

- 原始消息不删除；`topic_message_index` / transcript 保留。
- 摘要写 `lead_topic.summary` + episodic memory（cueAnchors: topicId / goalId / 项目路径）。
- compaction 事件记录 `topic_id`、`before_tokens`、`after_tokens`、`evicted_message_ids`。

### 4.6 旧 topic resume（切回继续）

入口：

- topic index 点击。
- Lead 回答里的「来自：<topic>」链接。
- Goal 详情「上下文来源」。

流程：

1. 读取旧 topic 的 `lead_session_id` / `owner_session_id`。
2. 若 session 仍存活：把 Lead 的活动指针切到该 session/topic；恢复 working set；写 `resumed_from`。
3. 若 session 已不存在：
   - 创建新 session；
   - 注入旧 topic summary + 关键消息 + `resumed_from` provenance；
   - 新消息写入新 session，旧 transcript 只读保留；
   - `lead_topic` 新增一行（或 `resumed_from` 指向旧 id），不覆盖旧行。
4. 恢复后 `state='resident'`，旧 topic 变 `warm`。
5. 不自动合并 Tech Lead 的工作上下文。

### 4.7 UI

- **Topic index**：Lead 对话侧边/弹出列表；标题、摘要、最后活跃、关联 Goal；搜索。
- **Recalled topic**：回答下方折叠「来自：<topic>」；可展开原文。
- **Working set 状态**：开发者模式可见（resident/warm/cold、token），普通用户不可见。
- **不出现**：session id、compaction 按钮、working set 术语。

## 5. API

| 接口 | 说明 |
|---|---|
| `GET /api/lead/topics?projectDir=&query=` | topic index；支持标题/摘要/全文检索 |
| `GET /api/lead/topics/:id` | topic 详情 + summary + 关键消息 |
| `POST /api/lead/topics/:id/resume` | 切回旧 topic；返回 `{ sessionID, resumedFrom }` |
| `GET /api/lead/working-set?projectDir=` | 开发者/诊断：resident/warm/cold + token |
| `POST /api/lead/compact` | 内部压缩；返回 before/after/evicted |
| `GET /api/lead/recall?projectDir=&q=` | 诊断：缺页候选与分数（不注入） |

### 事件

- `lead.topic.summarized { topicId, tokens }`
- `lead.topic.swapped { topicId, state }`
- `lead.topic.resumed { topicId, sessionID, resumedFrom }`
- `lead.compaction { topicId, beforeTokens, afterTokens }`

## 6. 失败模式

| 失败 | 处理 |
|---|---|
| 召回误命中 | 置信度阈值 + 最多 2 个 topic + 用户可撤销；低置信不注入 |
| 摘要漂移 / 丢决策 | 摘要 prompt 固定保留 decisions / open loops / user words；hash 防重复；可回读原文 |
| runtime history 已压缩 | 用 `topic_message_index` + `lead-handoff.md` + memory；不依赖 runtime 单点 |
| resume 时 session 冲突 | 串行化 topic resume；旧 session 只读；新 session 带 `resumed_from` |
| 首 token 延迟 | 召回同步轻量；摘要异步；超时 fail-open |
| 上下文串味 | 注入内容带 topic 标签；不把 Tech Lead 原始日志塞进 Lead |
| 预算超限 | 按 4.3 顺序裁剪；决策/未结/用户原话不裁 |

## 7. 测试与验收

### 单元

- `selectWorkingSet`：resident / warm / pinned / cold 选择；预算裁剪顺序。
- `estimateTopicTokens`：文本 / 工具输出估算。
- `recallTopics`：显式引用、标题命中、语义阈值、低置信不注入。
- `buildRecalledBlock`：summary + 关键消息 + topic 标签。
- `compactTopic`：保留决策/未结/最近；工具输出截断；原始消息不删。
- `resumePlan`：session alive → switch；session gone → rebuild + provenance。

### 集成

- 多 topic 对话 → 切到旧 topic → 回答能引用旧结论；无 session tab。
- 触发压缩 → 决策/未结仍在；原始 transcript 可查。
- 旧 topic resume → 新消息写入正确 session / 新 session；旧 topic 只读。
- 低置信召回 → 不注入，回答不串味。

### 评测

- 用现有 LongMemEval / 记忆评测子集：topic recall 的 answer accuracy、context tokens、latency。
- 自建 20 段多话题对话：recall precision/recall、误注入率、resume 后一致性。

### 指标

- Lead 每回合 context tokens 下降 ≥30%（相对 P0 长 session）。
- 旧 topic 引用回答正确率 ≥80%。
- 误注入率 <10%。
- 旧 topic resume 时间（点击 → 可继续）<2s。

## 8. 迁移与开关

- `lead_topic` 加列走 migration；存量行回填 `state='warm'`、`summary=null`，后台逐步生成摘要。
- 功能开关 `MAFW_LEAD_WORKING_SET`（默认开）；关闭时回退 P0 行为（当前 topic + 状态投影，不召回）。
- 摘要生成走后台 worker，失败不阻断对话；`summary_hash` 防重复。
- 不删除任何原始 transcript。

## 9. 开放问题

1. warm topic 默认 5 条是否合适？按项目活跃度可配置。
2. 缺页召回用 FTS 还是 embedding？P1 建议 BM25 + 轻量语义阈值，避免每次 LLM rerank。
3. 旧 topic resume 后，新消息是 append 到原 session 还是新 session？P1 建议：session 活着就切回 append；死了就新 session + `resumed_from`。
4. 摘要由谁生成：Lead 自己的回合、后台 worker、还是 memory pipeline？P1 建议后台 worker + 固定 prompt，不占用户回合。
