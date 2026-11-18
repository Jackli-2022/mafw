# 2026-11-18 · Auto Recall 精确证据准入与完整滚动窗口

- **分支**：`main`（未 push）
- **版本**：gateway **5.1.0**（schemaEpoch 1）；基线 `bc7d6e7d1`；Task 4 派发 HEAD `0a53e3207`；docs 交付 `7abefa364`
- **规格 / 排查**：`docs/research/2026-11-18-auto-recall-fok-divergence.md`
- **计划**：`docs/superpowers/plans/2026-11-18-auto-recall-exact-evidence.md`
- **实现与复核**：`gateway/volcengine/deepseek-v4.1-flash` 子代理逐任务实现；每任务独立同模型 reviewer 审查（1–2 轮 fix）；Task 4 由新执行者独立跑全量门禁、构建/热重启与 live before/after。
- **前序**：`docs/releases/2026-11-18-graph-expansion-channel-separation.md`（本切片不改图通道）

## 提交

| 任务 | 提交 | 内容 |
|---|---|---|
| 1 | `d025e33e0` `3faba895b` `1fe118dc5` | 固定 40 条 personal-recall 评测集、runner、契约测试与基线 |
| 2 | `bbea0b0b1` `9e42f33b7` `5d69cf0cd` | 确定性精确证据准入（`recall/exact-evidence.ts` + route 接线） |
| 3 | `8600a1370` `f1bcd5bd1` | snapshot 滚动窗口读 active+archive；helper 缺失时 fail-loud |
| 4 | `7abefa364` | 验证、live before/after、架构现状与交付记录 |

## 根因（摘要）

1. **边界 FOK ≠ 展示候选证据**：`computeRecallFokZone` 只看 `bm25RawScores` 的 top1/mean 比值（AUROC 0.582）。多条同强度精确命中会把比值压平 → `no-memory`/`low-confidence`，而同一批候选的 cross-encoder 概率已达 ~0.99。
2. **出口按策略抑制非 inject**：`hasRelatedRecallBody` 只放行 `inject`，于是已渲染好的候选本体在 route 出口被丢弃，只剩「相关记忆：无」。
3. **snapshot 窗口塌缩**：`recentTurnTexts` 旧实现经 `listTurns`/`readTurn` 只读 `t1_observations` 热表；T1 抽取归档后窗口塌成最新短指令，snapshot 自身 no-memory，无法被 route 采用。

## 修复（现状）

- **P1 精确证据准入**（`gateway/src/recall/exact-evidence.ts`）：仅当 FOK 非 `inject` 时，在 active 条目的 `primary_abstraction` / `cue_anchors` 上找确定性证据（整标题等价、整 query 形 identifier、7–40 位十六进制 commit、≥12 ASCII / ≥6 CJK 且 df≤5、覆盖 ≥50% 非空字符的短语）。命中条目按 specificity→id 确定性置前、去重、截到 topK=3，并把 zone 升级为 `inject`。`superseded_by` 与未 pin/sticky 的 legacy `episodic` 不参与；不读正文、不加 embedding/LLM；**未改 FOK 阈值、全局 topK、recency**；无证据时行为与旧版逐字一致。
- **P2 完整滚动窗口**（`snapshot-builder.ts: recentTurnTextsFromDb`）：`listSessionTurns`（`t1_turns`）+ `readTurnRows`（`t1_archive ∪ t1_observations`），取最近 4 个逻辑轮的 user/assistant 文本；kernel 刷新改用该 helper，export 缺失时 `log.warn` 而非静默停摆。
- snapshot 仍走 `rerankDetailed` 概率门，边界仍走比值门；本切片没有合并两套阈值。

## 新增测试（53 个）

| 文件 | 数量 | 覆盖 |
|---|---:|---|
| `gateway/tests/unit/eval/personal-recall-runner.test.ts` | 23 | fixture/runner 契约：类别计数、重复 id、未知 id、`must_exclude` stale、note-board 剥离、anchor 相对排名、汇总指标 |
| `gateway/tests/unit/recall/exact-evidence.test.ts` | 17 | 平坦比值 + 精确 identifier/cue 准入；标题等价；通用/短/部分重叠不准入；superseded/legacy episodic 不合格；冰岛负例不变；合并去重截断确定性；route 级 `5cd9885f5` 与负例形状 |
| `gateway/tests/unit/recall/snapshot-recent-turns.test.ts` | 13 | 归档后仍返回最近 N 轮；user/assistant 过滤；空轮；稳定顺序；`maxTurns=0`；部分归档/重开轮 union 去重；kernel 接线守卫 |

TDD：三个任务都先观察 RED（模块不存在 / 抑制未解除 / 热表窗口塌缩），再实现转 GREEN；Task 4 复核了固定用例未被放松。

## 验证（Task 4，本机，2026-11-18）

- `npx tsc --noEmit -p tsconfig.json`（gateway）：**通过**。
- 定向：**76 suites / 549 tests，549 passed，0 failed**（`tests/unit/recall` 全目录 + eval runner + recall 路由/指令 + T1 archive identity + session-recall-hook + pinned + recall-context + lead topic-recall）。
- 新测试单独复跑：**3 suites / 53 tests，53 passed**。
- Gateway 全量 `npm test -- --forceExit`：**1038 suites，8291 passed，2 skipped，0 failed**（`2 skipped` 为仓库既有）。
- `npm run build`（gateway）：**通过**；热重启令牌 `target=gateway, action=restart, commit=0a53e3207..., delayMs=5000`；**pid 28300 → 60752**，`/health` `status=ok`、`gatewayVersion=5.1.0`、`schemaEpoch=1`，`last-restart.json` 记录同 commit，令牌已消费。

## Live before/after（同一 40 条 query，1 条期望刷新）

- BEFORE：`C:\Users\15524\AppData\Local\Temp\opencode\personal-recall-before.json`（10:42，**旧构建**，pre-Task2）
- AFTER：`C:\Users\15524\AppData\Local\Temp\opencode\personal-recall-after.json`（**11:59:21 本地**，pid 60752，gateway v5.1.0，HEAD `0a53e3207`）
- 命令：`node evaluation/personal-recall/run.js --out <path>`

**可比性警告（必读）**：

1. Task 4 派发时旧的 pre-change live build **已不存在**（外部已于 11:44:03 构建、11:44:54 重启到含 Task 2/3 的 dist），所以 **BEFORE 无法在旧 live build 上重采**；BEFORE 是 10:42 的原始产物，AFTER 是新构建。
2. `exact-recent-turn-texts` 的期望刷新为 `g7u8qu` → active head `uidutw`（`g7u8qu` → superseded `0r8ks9` → superseded `uidutw`）；`uidutw` 创建于 11:04，**该新期望从未有过 pre-change 测量**。BEFORE/AFTER 是**同一 40 条 query 文本、但期望集有 1 条不同**。
3. 因此本表**不是**同口径代码 A/B：`exact` 分类 REST hit@1 90%→80%、总量 REST 60%→60% 都受这条口径变化影响，不能当作代码回归或无变化。
4. 可作因果归因的增量只有 **4 条 exact AUTO 准入**（且无正向条目反向退化），由 `arbiter-samples.jsonl` 的 post-admission `zone=inject` 与四个场景 body 佐证。

| 指标 | BEFORE（旧构建） | AFTER（新构建） |
|---|---:|---:|
| REST hit@1 / hit@3 / MRR | 60.0% / 73.3% / 0.656 | 60.0% / 73.3% / 0.656 |
| AUTO hit（注入证据） | 46.7%（14/30） | **60.0%（18/30）** |
| AUTO anchor rank@1 | 12/30 | 13/30 |
| 有 rank 时平均 anchor rank | 1.29 | 1.39 |
| false injection（10 negative） | 2/10（20%） | 2/10（20%） |
| stale injection（控制集 10→11 条） | 0 | 0（非同控制集，见下） |
| entrypoint agreement | 73.3%（22/30） | **86.7%（26/30）** |
| REST p50 / p95（max） | 84 / 92（93）ms | 103 / 127（**523**）ms |
| AUTO p50 / p95（max） | 248 / 411（581）ms | 307 / 436（**604**）ms |

- 延迟是同一台机器、同一时段但**未隔离负载**的测量（同时有构建、文档、探针与后台管线）；523/604ms 的 max 是单次抖动，不能当作精确扫描的固定成本。
- stale 的 `0→0` 不是同一控制集：刷新把 `g7u8qu` 加进 `must_exclude`（10→11）。准确解释是**结构性 0**——`resolveSupersededHeads` 会把 superseded 命中重写到链头，旧 id 本就不可返回；它只证明没有绕过该重写，不证明抑制策略变严。

分类（AFTER）：`current-state` auto 60% 不变；`exact` auto **60%→100%**（同 10 条 query、1 条期望刷新；REST hit@1 90%→80% 属口径变化，非同口径代码回归）；`implicit` auto 20% 不变；`negative` false 20% 不变。

逐条变化（BEFORE→AFTER）：

- `exact-5cd9885f5`：AUTO miss→hit，rank1。
- `exact-topic-tool-design`：AUTO miss→hit，rank2（目标 `fuy5mr`）。
- `exact-graph-commit`：AUTO miss→hit，rank1。
- `exact-note-board-budget`：AUTO miss→hit，rank2。
- `implicit-unattended-background`：REST rank2→rank1（AUTO 仍 miss）。
- `exact-recent-turn-texts`（期望刷新条目，非纯增量）：AFTER REST rank 1→2、AUTO anchor rank 1→2；等价的合法 owner `nl2po5`（"snapshot 只读热表致窗口塌缩"）排第一，目标 `uidutw` 第二。该 entry 的排序确实后移，不能只记增益。
- 按各自（含刷新后的）期望统计，无正向条目从 hit 退化为 miss；剩余 `REST hit@3 && AUTO miss` 4 条，全部是 implicit paraphrase。

### 四个原始场景（AFTER，直接读 `/api/recall/context` body）

| 场景 | 结果 |
|---|---|
| `5cd9885f5` | `<recall>` 本体存在；`htv0sz` 第一条（BEFORE：无本体） |
| `Proactive Topic Recall 主题工具设计` | 本体存在；目标 `fuy5mr` 为第 2 条 anchor |
| `检索路径 parity 修复上线与质量缺口` | 本体存在；`htv0sz` 第一条（保持） |
| 冰岛消费无答案 | 无 `<recall>` 本体，`no-memory`（负例保持干净） |

`~/.mafw/logs/arbiter-samples.jsonl` 同刻样本：q=9 / q=29 / q=21 → `zone=inject`，q=15（冰岛）→ `zone=no-memory`；该 zone 为精确准入之后的值。

## Fixture 主动刷新（唯一期望变更）

`exact-recent-turn-texts`：`must_include` `mem_1794966028575_g7u8qu` → `mem_1794971043993_uidutw`；旧 id 移入 `must_exclude` 作为 stale 对照。链条：`g7u8qu` → superseded by `0r8ks9` → superseded by active head `uidutw`（同一 R1/R3 事实族，保留 `recentTurnTexts` / `readTurnRows` / `listTurns` 锚）。检索会把旧 id 重写到链头，旧期望永远无法返回。README 记录 refresh log，runner 测试新增链头/旧 id 断言。其它 39 条期望未改。

**该刷新对可比性的影响**：`uidutw` 创建于 11:04，晚于 10:42 的 BEFORE 运行，所以**新期望从未有过 pre-change 测量**；旧 live build 又已在 Task 4 派发前被外部替换。因此「同一 40 条 query」不等于同一期望集，相关 REST/AUTO 比率不能当作纯代码 delta（见 Live before/after 的可比性警告）。

## Snapshot 窗口证据（读取修复）

只读 DB + 编译后 helper（`recentTurnTextsFromDb`，db 包装与 `GatewayDatabase.listSessionTurns`/`readTurnRows` 同 SQL）。**测量时刻 2026-11-18T04:02Z**（gateway **v5.1.0**，pid 60752，HEAD `0a53e3207`）。表里的「热表行 / 归档行」是**时间相关**计数：抽取/压缩还会继续把行从 `t1_observations` 搬到 `t1_archive`，因此这些数字是可复现当时状态的快照，不是稳定常量。

| session | 逻辑轮 / 热表行 / 归档行（04:02Z） | 新窗口（最近 4 轮） | 旧热表窗口 |
|---|---|---|---|
| `ses_e7444718cffeVJ3eJOTAReq8F0` | 182 / 14 / 1484 | 4 texts，15 chars（`如何修复 修 让子代理来 继续`） | 0 texts（空查询） |
| `ses_e757f19d7ffeHwTJPmS4NhuBOY` | 113 / 0 / 1911 | 4 texts，25 chars（`批准设计 native 修 minors 梳理进度`） | 0 texts |
| `ses_f340590b5ffeutrCGzTkEOVLb0` | 35 / 0 / 6214 | 12 texts，7164 chars → query 599 chars | 0 texts |

修复前落盘的同一会话快照（旧构建）：`ses_e7444718...` 的 `query="继续"`（2 字符）、`fok=no-memory`、`top1prob=0.099`；`ses_e757f19d...` 为 `query="梳理进度"`。这正是「窗口塌成最新短指令」。

**未观测到的部分（不声称）**：热重启后 5 分钟内，日志没有新的 `snapshot built`/`snapshot served`，kv `recall-snapshot` 也没有新行（最后一次 build 为 03:52:51Z，早于重启）。重启后该会话确有一条 `user_input`（04:00:21Z）并触发了防抖，但 90s 空载窗口后仍未观测到构建完成；因此本次**不声称** snapshot serving 已在真实回合生效，也不把 live snapshot 指标当作验收。原因是构建/调度静默失败不可观测（R6/P4 的观测缺口），需要独立切片。

## 独立复核

- Task 1：2 轮 fix 后 review clean（fixture 不得为通过而放松；active-only 校验）。
- Task 2：2 轮 fix 后 review clean（精确证据只在非 inject、最终 topK=3、确定性、无 recency）。
- Task 3：1 轮 fix 后 review clean（归档后窗口、union 去重、接线守卫）。
- Task 4：本报告的全量与 live 结果由新执行者独立复跑；未复用前序测试输出。
- 记录：`.superpowers/sdd/2026-11-18-auto-recall-exact-evidence/progress.md` 与各 `task-*-report.md`。

## 尚未解决（不声称整体质量完成）

1. **100ms 契约**：AFTER AUTO p50/p95 = 307/436ms（max 604ms），仍远超插件 100ms abort；本轮同机负载未隔离，不能把 +59ms p50 全部归因于精确扫描，需独立性能切片（先建 16k 真实语料端点基线，再谈工作预算）。
2. **尾部弱相关**：`temporalNeighbors.presentation` 的 `↳` 邻居与 BM25 2–3 名仍在；属呈现/候选池问题。
3. **FOK 观测混合**：`snapshot_build` 与真实 injection 都写 `inj` 样本，准入效果暂不能用 FOK 率校准。
4. **snapshot 自然刷新不可观测**（上文），以及 post-restart 构建为何未完成未知。
5. **implicit 覆盖**：4 条 paraphrase 仍 `REST hit@3 && AUTO miss`；精确准入按设计不覆盖普通词面重叠。
6. **BEFORE/AFTER 非同口径**：旧 live build 在 Task 4 派发前已被外部替换，BEFORE 无法重采；`exact-recent-turn-texts` 的期望刷新（`g7u8qu`→`uidutw`）使 exact REST hit@1 90%→80% 只是口径变化，且该 entry 的 REST/AUTO rank 都从 1 后移到 2（`nl2po5` 第一）。不要把总量 60%→60% 读成同口径代码无变化。
7. 本切片之外的其他会话未提交改动（`adapters/opencode` 与 3 个 gateway 测试）**未纳入本提交**，也未回滚。
