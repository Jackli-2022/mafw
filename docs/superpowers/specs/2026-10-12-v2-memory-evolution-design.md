# V2 记忆演化：机械捕获 + 三层去重 + 巩固层重写（2026-10-12）

> 状态：设计定案（brainstorming 收敛），待用户批准后出实施计划。
> 架构依据：`docs/research/2026-10-10-memory-target-architecture.md`（唯一架构引用）+ `docs/research/2026-10-12-brain-memory-update-mechanisms.md`（更新机制综合，Sevenster PE 三段划界）。
> 风险姿态：**A 拆分版**——加性机械项 live；管线行为变更 shadow/A-B 起步。
> 前置：V1 verbatim dense 层已部署（v4.26.0，1933 测试绿，t1 11791 向量）。

## 0. 决策记录（2026-10-12 与用户敲定）

| 决策点 | 结论 |
|---|---|
| MinHash | **退役**（非标记化）：写路径 + classifyInsight 双摘除；worktree 融合保留；历史链不动 |
| 去重架构 | 三层：写时 exact-hash / 读时近重复折叠 / 巩固层语义合并（dupCandidate→graceRevisit） |
| 宽限期 | 48h 窗 × PE 门控（复用 selectNewerRelated）× reflection 同 cron 新 phase |
| 学习率 | 能量梯度化：worker-origin 首过 cap 0.6，无 PE 窗末毕业 0.75；A2 tentative（0.35）维持正交 |
| ⑦ 姿态 | live+flag（t1 层补位承担近期检索，FTT 双轨迹） |
| 判官 | routeAndWrite（laya+G2）单一判官；机械判官（MinHash 分带）全部摘除 |

## 1. 七项设计

### ① MinHash 退役 + 三层去重 + 机械捕获

**1a. 摘除（live）**
- `harmonic-unit-store.ts` write() 摘 `MinHashMerger.merge()` 调用（`skipMerge` 选项随之删除，LongMemEval 基准的确定性由摘除天然满足）。
- `reflection.ts` `classifyInsight()`（MinHash 0.6/0.4 分带 duplicate/conflict/novel）**整段摘除**——它在 routeAndWrite 之前抢答，laya 影子日志被污染（写路径 MinHash 同款病灶）。insight 流直接进 routeAndWrite；其 conflict-supersede 职责迁 ④ graceRevisit。
- 保留：`mafw_merge_memory`（worktree 融合）的 MinHash 比对（显式交互路径）；`resolveSupersededHeads()` 与存量 supersede 链（检索出口照常兑现）。
- `ReflectionResult.deduped/superseded` 字段语义调整：deduped = routeAndWrite skip；superseded = graceRevisit update 计数。

**1b. 三层去重**
- **L1 写时 exact-hash 守卫（live）**：`/api/memory/add`（MCP + HTTP 双入口收敛点）计算 `memory_value` sha1 → 内存 LRU（最近 10k）查重 → 命中即 skip + `[Dedup] exact-hash` 日志。不落盘（进程重启丢失可接受——读时折叠兜底）。
- **L2 读时近重复折叠（live+flag `memory.dedup.readCollapse`）**：`searchScored()` 出口（`resolveSupersededHeads()` 同点之后）对 top-30 候选折叠——嵌入可用时 cos≥0.92；不可用时 token-set Jaccard≥0.8（对 `primary_abstraction`+`cue_anchors` 分词）。保 energy 高→新 者胜出，其余不进返回列表。**纯呈现层，零数据变更，零回退成本**。折叠加统计计数进 `/api/memory/stats`（observe 仪表）。
- **L3 巩固层语义合并（observe）**：ConsolidationService 候选召回（dense ≥0.8）标 `dupCandidate` anchor（不自动 UPDATE——laya 校准通过前）；真正的合并执行位是 ④ graceRevisit 的 merge verdict。

**1c. 机械捕获（live，加性）**
- **GLiNER 实体收割**：写路径 fire-and-forget（与嵌入同模式，2s 防抖批量）。模型：GLiNER ONNX（~100M 级，`knowledgator/gliner_multi` 系或等价；加载失败 fail-open 跳过）。label 集：工具/项目/版本/概念/命令（可配）。产物进 `cue_anchors`（去重、每条 cap 10）。与现有 regex 收割（camelCase/ALL_CAPS/引号串，`reflection.ts:357-369`）合流为统一 harvester。
- **novelty = 1 − maxCos(新条目向量, 库内 top-1)**：嵌入批量 flush 后异步计算；`HarmonicIndexEntry` 扩展 `novelty?: number` 字段（index 白名单 + OKF frontmatter）。embedding off → null（fail-open）。消费方：④ PE 门控排序、⑥ salience v2、未来 D3 反馈路径。

### ② TCM 事件分段（shadow）

新模块 `recall/topic-segmentation.ts`（纯函数）：
- 输入：会话 `t1_archive` 时序行流；输出：边界打分数组 + 切段。
- 机制：TCM 式运行向量（滑动窗口词项加权质心），相邻余弦跌破阈 = 边界；**Tier0 结构信号强制切**（文件路径切换 / goal 边界 / 工具失败 / 会话边界）。段键 = 封存段向量（"切分器=索引器"原则）。
- shadow 模式：每小时 turnCompress 批处理时并行计算"若按事件段切"的边界，落 `segmentation-shadow.jsonl`（对照用），**不接触发器**。
- flag：`recall.segmentation = 'off' | 'shadow' | 'live'`，默认 `shadow`。

### ③ F 层读事件段原文（off→A/B，依赖②）

turnCompress worker prompt 增加"事件段 verbatim 摘录"区块（t1_archive 原文按段取，cap 4000 字符/段）——与现有 batch transcript 并列注入。A/B：同会话按天交替 batch-only / +event-segment 输入，对比产出记忆的 7d need 命中率（2 周窗口）。flag：`recall.eventSegmentInput`，默认 off。

### ④ graceRevisit（shadow→live）

`reflection.ts` 新 phase（`runAll()` 尾部；`runSession()` 不含——选样是全局跨会话的）：
- **选样**：`age ≤ 48h` 的 semantic/procedural、未 superseded、无 `rejected/redundant:` 锚；**PE 门控**——复用 D2 的 `selectNewerRelated()`（`reconsolidate-pipeline.ts:22`）：以 gist 自身为 query，存在"创建后新增的高相关内容"才入选；无 PE 不重访（Sevenster：无 PE 不开窗）。
- **prompt**：gist 全文 + 新证据列表 → verdict `keep / update / merge / demote`。
  - update = 加法式：写新版本 + `supersedes` 旧（Lei 2024，禁止 in-place）
  - merge = dupCandidate 对收敛敛成一条（新条目继承双方 cue_anchors，旧走 supersede）
  - demote = energy 0.05 + `rejected` 锚
  - **authority=user 的条目只记 verdict 不执行**（pipeline 不改写用户记忆，G1 纪律）
- **预算**：PipelineBudget `reflect` 门 + heartbeat `record('graceRevisit')`。
- **与 D2 分工**：D2 = 检索触发（任意 age）重访；graceRevisit = 时间窗触发（年轻 gist）重访；选择器共享 `selectNewerRelated`。
- flag：`recall.graceRevisit = 'off' | 'shadow' | 'live'`。shadow = 选样+prompt 跑、verdict 只落 `grace-verdicts.jsonl` 不执行；live = 执行（user 权威条目除外）。

### ⑤ reflection 交错（随④）

- Step 2 evidence 检索 `bm25 → hybrid`（`graphExpand: false` 维持）。
- evidence 排序：宽限期内的 gist 前置（reconcile 目标优先于普通证据）。
- A4 会话内 need 反馈块维持不变（跨会话 reconcile 由 ④ 承担）。

### ⑥ salience v2（observe）

- 合成：`f(静态 salience, 7d need, authority, novelty)`——归一化加权和（权重系数 shadow 期标定）。
- 输出：`~/.mafw/logs/salience-v2.jsonl`（id、分量、合成值），**不写回条目、不动排序**。
- 挂点：graceRevisit 选样趟顺带计算（零新增调度）；embedding off 时 novelty 分量缺省 0.5。

### ⑦ 学习率梯度化（live+flag）

- **cap**：`/api/memory/add` 写路径——worker-origin（V1 `worker-origin.ts` 判定）的 semantic/procedural 首过 `energy = min(计算值, 0.6)`；manual/用户直写不封顶。
- **毕业**：`age > 48h && energy ≤ 0.6 && 未 superseded && 无 rejected 锚` → energy 提 0.75（纯机械，挂每日 decay pass 顺带扫描——**独立于 ④ 的 LLM 部分**，④ off 不阻塞毕业）。有 PE 且 verdict=keep → 0.75（随 ④ live）。
- A2 tentative（0.35 / 跨 episode 判准 / Day-1 二值 verdict）**维持不变**——与梯度正交。
- flag：`recall.commitmentGradient`，默认 true。
- 依据：FTT 双轨迹——近期检索由 t1 verbatim 层承担（V1），gist 慢熟；behavioral tagging。

## 2. Flag 矩阵总表

| flag | 值 | 默认 |
|---|---|---|
| `memory.dedup.exactHash` | bool | **on** |
| `memory.dedup.readCollapse` | bool | **on** |
| `recall.entityHarvest`（GLiNER） | bool | **on**（fail-open） |
| novelty | 随 embedding provider | on（off 时 null） |
| `recall.segmentation` | off/shadow/live | **shadow** |
| `recall.eventSegmentInput` | bool | off（A/B 时开） |
| `recall.graceRevisit` | off/shadow/live | **shadow**（live 需 shadow 期 verdict 质量确认） |
| `recall.commitmentGradient` | bool | **on** |

## 3. 实施批次与依赖

- **批次 1（先行，无依赖）**：①a 摘除 + ①b L1/L2 + ⑦ cap/毕业——全部纯后端可测，互相独立小项。
- **批次 2（依赖嵌入）**：①c GLiNER + novelty。
- **批次 3（管线改造）**：④ graceRevisit + ⑤ evidence 升级 + ⑥（挂 ④ 趟）。
- **批次 4（依赖 ②）**：② TCM shadow → ③ F 层读原文 A/B。
- 规模估计：1-2 周。TDD：纯函数先行（exact-hash / fold / selectYoung / graduation / boundary / novelty），再接线集成。

## 4. 测试与验收

- 每批次交付：新增测试数 + `cd gateway && npx jest --runInBand` 全量通过数（既有基线 1933）。
- 关键回归：LongMemEval 摄入确定性（MinHash 摘除后 `skipMerge` 语义）、`resolveSupersededHeads` 出口行为、检索 100ms 契约（折叠必须 O(k²) 微秒级）。
- shadow 仪表：`/api/memory/stats` 增 exactHash skips / collapse count / graceRevisit {selected, verdicts} / graduation count。

## 5. 风险与协调

- **并行会话协调**：另一会话在做 consolidation 判官跟进（conflict 判官已部署、MinHash preemption 终判）——①a classifyInsight 摘除正是给该线让路；批次 3 动工前 sync 其产物，避免重复实现 conflict judge。
- **t1 存储债**：novelty 复用既有嵌入不新增存储；紧凑格式（Float32）是 V1.5 债，V2 不处理。
- **读时折叠误伤**：折叠阈值 0.92 保守起步，observe 计数异常再调；flag 一键关。
- **A2 判准不变**是刻意约束——若观察到 promote/reject 语义与新梯度冲突，回 brainstorm 不就地改判准。

## 6. 非目标（本 spec 明确不做）

- ConsolidationService 自动 UPDATE 开闸（等 laya 校准 + shadow verdict 质量——V2.5/V3）。
- t1 向量紧凑格式与运行期窗口淘汰（V1.5 债）。
- N1 实体概念层（GLiNER 只收割进 cue_anchors；identity 判定与实体表是 V3）。
- REM 生成性重组 pass（N2 远期）。
