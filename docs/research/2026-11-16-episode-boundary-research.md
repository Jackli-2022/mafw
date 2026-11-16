# Episode boundary research · 2026-11-16

**问题**：T1 的 `t1_episodes` 边界怎么切？用户给的定义是“主体完全变了，想要讨论的事情变了”，不接受纯时间窗口。

## 结论先行

**声明优先的混合边界**：

1. **主信号：显式声明**（agent / user 在换任务时标一个 boundary）
2. **兜底：多信号推断**（specific actor 集合、concept/entity 重叠、intent 漂移、结构断点）
3. **时间只做弱先验**，不做定义
4. **先 shadow**，用边界质量和检索收益双重评估，再决定是否 live

不建议：纯时间窗口、纯 TCM 词面向量、纯事后 LLM 分段。

## 1. 认知科学

### Event Segmentation Theory（Zacks et al. 2007）

- 人持续维护一个 **event model**（当前情境的预测模型）。
- 当预测误差或预测不确定性升高，event model 更新，主观上就是“一件事结束了”。
- 事件维度：**time / space / entity / causality / goal / protagonist**（不同论文措辞略有差异）。
- 边界不是单一时钟，而是多维度同时或连续变化。

### Event Horizon Model（Radvansky & Zacks 2017）

- 边界把连续活动切成 event models；跨边界后，旧 event model 的信息可及性下降。
- 这解释了“walking through doorways causes forgetting”：换房间（space）就切事件，旧信息被留在上一个模型里。
- 对 MAFW 的启示：边界不是纯检索优化，它决定“哪些 turn 应该一起被记住/一起被遗忘”。

### 海马体与边界

- Ben-Yakov & Henson 2018：电影事件边界处海马体活动升高，边界越显著，活动越强。
- 海马体不是“边界检测器”，它把边界两侧的片段绑定成可区分的 episode index。
- 启示：T1 应该在**编码时**记录 boundary 和 episode id，而不是检索时临时猜。

### 预测误差 vs 预测不确定性

- Nguyen et al. 2026（eLife）：error-driven 与 uncertainty-driven 边界都能独立预测人类标注，说明边界至少有两类成因。
- 对 agent 日志：工具失败/报错更像 error-driven；话题逐渐漂移、意图不清更像 uncertainty-driven。

## 2. 对话/文本分段

### TextTiling（Hearst 1997）

- 在固定窗口之间算词面重合，找“低谷”（depth score）作为边界。
- 优点：便宜、可解释、无需训练。
- 缺点：词面重合对 paraphrase 弱；阈值依赖语料；短对话不稳定。

### Embedding-enhanced TextTiling（Song et al. 2016）

- 用 utterance embedding 替代纯词面相似度，对口语/短文本更稳。
- 仍然是相邻窗口比较，不解决“多信号”问题。

### 其他路线

- GraphSeg / 图方法：句子 embedding 建图，找社区边界；对长文本更好，成本更高。
- 监督/对比学习（DialSeg 等）：需要标注数据。
- LLM 事后分段：质量可能高，但每次都要调用、不可复现、成本高；适合离线校准，不适合在线每个 turn。

## 3. Agent 轨迹分段（最相关）

**Wei 2026, “Trajectories That Segment Themselves” (arXiv 2608.02302)**

- 让 acting agent 在 rollout 中显式声明“当前因果假设”，假设切换就是 phase boundary。
- 声明成本：平均 52 tokens/次，占 agent 输出约 9.8%，占完整 transcript 约 0.57%。
- 关键结果：
  - 删掉声明后，外部观察者仍能以 2.18× chance 把 action block 归因到对应假设；
  - 等长窗口只有 2.07×，声明边界更好；
  - **机械规则（每次 test 后切）在严格/宽松两端都不优于随机**；
  - code-blind 人工标注能找到边界，但会过度分段（40 个真实边界，标了 62 个，命中 24 个）。
- 结论：**语义边界真实存在，但便宜的机械规则复现不了；让 agent 自己声明是当前最便宜、最可靠的来源。**

这条证据直接支持“声明优先”。它也警告：不要指望 `tool failure` / 固定窗口 / 纯 lexical 规则能切对。

## 4. 当前仓库现状

`gateway/src/recall/topic-segmentation.ts`：

- TCM running vector，token 级（英文 `[a-z0-9_]{2,}`，中文按单字）。
- `alpha=0.3`, `cosineThreshold=0.2`，当前向量 vs 历史运行向量。
- 结构断点：tool failure（`error|failed|failure|exit code [1-9]`）或文件目录切换。
- 只用于 shadow log / event-segment prompt 输入，**没有写 T1 episode**。

Phase C 之后可用的新信号：

- `t1_turn_features`：intent / action / tool / target / error / decision / entities
- `t1_turn_actors`：specific actors（`agent:*` / `tool:*`），可排除 `user:local`
- `t1_turn_concepts`：canonical concept id
- `t1_sparse_terms`：concept / actor / entity / token / semantic
- `trajectory_events`：tool / agent / error
- `goal_id` / session metadata / 文件目录

缺口：

- 没有 `t1_episodes` / `t1_episode_members`
- 没有 boundary 声明入口
- 没有 boundary 质量评估（Pk / WindowDiff / 检索收益）
- TCM 只看词面，actor/concept/intent 都没进边界判断

## 5. 候选方案

| 方案 | 信号 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 纯时间窗口 | gap > N 分钟 | 最简单 | 用户明确不接受；同话题跨时间会被切 | 否 |
| B. 纯 TCM 词面 | token running vector | 已有、便宜 | 中文单字噪声；paraphrase 漏；机械规则证据弱 | 只做兜底 |
| C. 多信号推断 | actor + concept + intent + 结构 | 不需要 agent 配合；可解释 | 阈值难定；误切/漏切都会发生 | 兜底 |
| D. Agent 声明 | 显式 `episode_break` | 证据最强；语义准确；成本低 | 需要工具/prompt；agent 可能忘记 | **主信号** |
| E. LLM 事后分段 | 整段 transcript | 质量潜力高 | 成本、不可复现、延迟 | 离线校准 |

## 6. 推荐设计

### 6.1 边界来源

```text
boundary_source:
  declared   ← agent/user 显式声明（主）
  inferred   ← 多信号推断（兜底）
  session    ← session 结束强制封口
  max_length ← 长度保护
```

### 6.2 推断规则（只在没有声明时用）

按优先级：

1. **specific actor 完全换掉**：`specificActors = actors - user:local`；当前 turn 与 episode profile 交集为空，且两边都非空。
2. **讨论对象完全换掉**：`concepts ∪ entities` 与 episode profile 交集为空。
3. **intent 漂移**：当前 intent 与 episode intent 的 embedding cosine < 阈值（初始 0.45，shadow 校准）。
4. **结构断点**：goal_id 变化、项目/目录切换、tool failure 后重启。
5. **时间弱先验**：gap > 2h 只作为加分，不单独触发。
6. **长度保护**：episode > 30 turns 强制封口。

规则 1/2 对应用户说的“主体完全变了，想讨论的事情变了”；规则 3 处理“词换了但意图也换了”；规则 4 是 TCM 已有的结构信号。

### 6.3 Episode 记录

```sql
t1_episodes (
  episode_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  goal_id TEXT,
  boundary_source TEXT NOT NULL,   -- declared | inferred | session | max_length
  boundary_reason TEXT,            -- actor_shift | topic_shift | intent_shift | goal | dir | error | time | length
  confidence REAL NOT NULL DEFAULT 0,
  intent TEXT,                     -- 首 turn feature 派生
  outcome TEXT,                    -- 末 turn feature / goal verdict 派生
  actors_json TEXT,                -- specific actors union
  concept_ids_json TEXT,
  source_trace_ids_json TEXT
);

t1_episode_members (
  episode_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  turn_seq INTEGER NOT NULL,
  PRIMARY KEY (episode_id, trace_id)
);
```

不写叙事；`intent`/`outcome` 是结构化字段，内容靠 trace 还原。

### 6.4 声明入口

最小方案：新增 MCP/native tool `mafw_mark_episode_boundary({ reason?, intent? })`，agent 在任务切换时调用。
插件侧同时支持用户显式指令（例如 `/new-episode`）触发。

成本控制：不要求每个 turn 都声明，只在“换任务/换主体”时声明；漏声明由推断兜底。

### 6.5 评估

1. **边界质量**：Pk / WindowDiff / boundary F1，对 declared vs inferred vs TCM baseline。
2. **检索收益**：`what happened in episode X` / `last time we...` 的 recall@k，比较 turn-level 与 episode-level。
3. **稳定性**：同一 session 重复运行，边界不应抖动。
4. **成本**：声明 token 占比、推断 CPU 开销。

Shadow 阶段只写 `t1_episodes`（`boundary_source='inferred'`），不改变现有召回；声明入口可以先在 dev 打开。

## 7. 待用户决定

1. 是否接受“声明优先”的入口（新增 tool + prompt 约束）？
2. 时间 gap 是否允许单独触发边界，还是只做弱先验？
3. 存量 `episodic` 迁移策略（legacy 只读 / LLM 转 semantic / 直接排除召回）。

## 参考

- Zacks, Speer, Swallow, Braver & Reynolds (2007). Event Segmentation Theory. *Psychological Bulletin*.
- Radvansky & Zacks (2017). Event boundaries in memory and cognition. *Current Opinion in Behavioral Sciences*. PMC5734104.
- Ben-Yakov & Henson (2018). The hippocampal film editor. *J Neurosci*.
- Nguyen et al. (2026). Multiple event segmentation mechanisms in the human brain. *eLife*.
- Hearst (1997). TextTiling.
- Song et al. (2016). Dialogue Session Segmentation by Embedding-Enhanced TextTiling. *Interspeech*.
- Wei (2026). Trajectories That Segment Themselves: Agent-Declared Boundaries as a Training Unit. arXiv:2608.02302.
- 本仓库：`gateway/src/recall/topic-segmentation.ts`, `gateway/src/recall/turn-pipeline.ts`, `docs/releases/2026-11-16-t1-sparse-episode-code.md`.
