# 2026-11-18 · verify-before-display 离线只读实验

## 0. 结论

**未达标，不应按当前 `probHigh=0.5` 恢复自动展示。**

- 4 个目标在 live BM25 中仍然都是 expected target rank 1；实时边界仍为 FOK low/no 且不显示 body。
- 按真实 snapshot/MCP 规则（BM25/CE 融合 top1，再读取该候选的 CE 概率）6/20/50 三种池都恢复 **4/4**；snapshot 形状的 6 条 BM25-only 重放也恢复 **4/4**。
- 但 50 条预锁定控制在 6/20/50 池中分别产生 **19/22/24 个 false-verification**；任一池合计 24 个不同 query 会错误展示。
- 12 条预锁定 hard negative 没有一条概率高于 target，但 **4 条跨过 `probHigh=0.5`**，也不满足安全门。
- 主要失败在 **verifier 区分力/阈值泛化**，不是召回。扩池使错误和延迟都变差。
- 下一步应先改 verifier 的目标、输入或校准，并用新的 memory-family 隔离 held-out 复验；**不建议以上下文更弱的 lexical-clue 自动展示作为补救**。若做 lexical-clue，只能是独立的 shadow 对照，不能进入准入。

本实验没有修改生产代码、配置或记忆数据，没有 commit，没有重启 gateway，没有调用记忆工具，没有派生子代理。本实验在仓库中只新增本报告；工作区原有及并行会话的其他改动均未触碰。

## 1. 数据、代码与实际配置

| 项 | 值 |
|---|---|
| 仓库 commit | `9ede56b418e278c4081de596e5d034472e1a2338` |
| live 索引 | 17,020 entries / 11,683 active |
| 冻结索引 SHA-256 | `9cf58714120cabed5ade8ed8a42a3fc677e2acc5d85041b38c82bfb6533ea9b4` |
| reranker | `llamacpp`, Vulkan, Qwen3-Reranker-0.6B Q4_K_M GGUF |
| 生产 warm sidecar | `127.0.0.1:5664`，只读复用 |
| `probLow / probHigh` | `0.2 / 0.5`（实时 `GET /api/config`） |
| 边界 FOK ratio low/high | `1.2 / 1.35` |
| `MAFW_RERANKER_RECENCY` | Process/User/Machine 均未设置；实验 `recencyWeight=0` |
| CE 输入 | 仅 `primary_abstraction + cue_anchors`，实现内 1200 char cap；不使用 `memory_value` |
| CE dist SHA-256 | `0b51f634d7cfc7c821f00904162ec5a4ea4b1502c4436bf307f203a95550ae07` |

实际代码规则：

1. `rerankDetailed` 对 CE 概率和 BM25 score 分别 min-max，按 `0.5/0.5` 融合排序；概率数组仍对应输入顺序。
2. snapshot/MCP 取**融合第一名**，再用该 id 对应的原始 CE 概率划分 `no-memory / low-confidence / inject`。
3. snapshot route 只在 `inject` 时显示 body。不能把“任意非 top1 候选高分”误算成已展示；本报告另列 strict-any-high 诊断。
4. 当前 snapshot 并不是 20/50 池：`buildSnapshot(topK=3)` 调 `search(topK*2=6)`，后者经 `searchRecallMemories(topK=6)` 得到最终 6 条。MCP 默认 topK=20 才形成 40 条初检池。20/50 是后台扩池可行性实验，不是现有 snapshot 默认输入。

候选来源：

- 6/20/50 池的 id 与顺序来自 live `GET /api/memory/search?topK=50` 的真实 graph-off BM25 结果。score 用同一冻结索引、同一代码的 graph-off `searchScored` 在近重复折叠前恢复；没有手工塞入候选。
- 实时边界用只读索引副本和只读 SQLite 图数据重放 `searchRecallMemories(topK=3)`，并调用 live `GET /api/recall/context`（无 sessionID）复核实际 body。
- 另跑 `snapshot-shape-6-bm25-only` 以复现 snapshot verify 的 score 形状。它不是 production hybrid+dense 的完整快照重放，因此明确标为 BM25-only 近似。

## 2. 四个目标：live BM25 / FOK / 当前显示

冻结 expected families（只用 fixture ids 判定 target）：

- `implicit-field-passing`: `qige2r`, `xzeo25`, `m8eijx`, `joizwn`（完整 id 在 `baseline.json`）。
- `implicit-multisession-gap`: `mem_1788836646433_2aa585`。
- `implicit-unattended-background`: `mem_1788838727545_igpk6x`。
- `implicit-live-index-overwrite`: `jbmd90`, `eip69g`, `6wzvp9`（完整 id 在 `baseline.json`）。

| query id | live BM25 target | 边界重放前三候选 | FOK ratio / zone | 当前 body |
|---|---|---|---|---|
| field-passing | rank 1 `mem_1788760998562_xzeo25` | `xzeo25 → jic1tl → s7eaxc` | 1.273487 / low-confidence | 不显示 |
| multisession-gap | rank 1 `mem_1788836646433_2aa585` | `2aa585 → sh4p00 → vs4ylt` | 1.100639 / no-memory | 不显示 |
| unattended-background | rank 1 `mem_1788838727545_igpk6x` | `igpk6x → 0wio7d → 1ga9n3` | 1.229044 / low-confidence | 不显示 |
| live-index-overwrite | rank 1 `mem_1791177124326_jbmd90` | `jbmd90 → ux1myg → ms7v3y` | 1.270421 / low-confidence | 不显示 |

边界前三中的缩写均为 id 最后 6 位；完整 id、cue 和 abstraction 在原始 JSON。四条 live BM25 第一候选与边界重放第一候选一致。

### 2.1 CE 与恢复判定

下表使用 6 条 live BM25 池；`CE rank` 是纯概率排名，`fused rank` 才是生产排名。

| query id | target probability | CE rank / fused rank | fused-top zone | 生产恢复 | 纯 CE top1 恢复 |
|---|---:|---:|---|---|---|
| field-passing | 0.998745868 | 2 / 1 | inject | **是** | 否 |
| multisession-gap | 0.999439282 | 1 / 1 | inject | **是** | 是 |
| unattended-background | 0.998610412 | 1 / 1 | inject | **是** | 是 |
| live-index-overwrite | 0.997798120 | 1 / 1 | inject | **是** | 是 |

`field-passing` 的纯 CE 第一是 `jic1tl`（0.999282378），fixture target `xzeo25` 第二；但 BM25/CE 融合后 target 第一，所以真实 snapshot/MCP 规则恢复。没有为了凑通过而把 fixture 之外的 `jic1tl` 改标成 target。

| 池 | 生产恢复 | 备注 |
|---|---:|---|
| live BM25 6 | 4/4 | 边界近似；所有 target 融合 rank 1 且过 0.5 |
| live BM25 20 | 4/4 | 后台实验，不是当前 snapshot 默认池 |
| live BM25 50 | 4/4 | 后台实验；实际数量为 47–50（取决于真实 BM25 命中数） |
| snapshot-shape-6-bm25-only | 4/4 | BM25-only snapshot verify 形状近似 |

## 3. 控制集：预锁定与 false-verification

### 3.1 筛选过程

- 首次 CE 调用前锁定：中文同域 20、English 10、CJK 10、既有 fixture negative 10，共 **50 条**。
- 没有 CE 后替换、删除或调参；`rejected=0`, `replacements=0`。锁文件 SHA-256：`762a9592ac2de2d302d1a51391aa3da041c5eba9d5d792efda1cec53c8ba7953`。
- 新控制先检查 active metadata 的 distinctive term，再人工核查真实 live BM25 前三的 abstraction/cue；保留真实 top50 作为 CE 输入。
- 子串误命中单独复核：例如 `ReFS` 命中 `refs/tags` 而非文件系统，`RBAC` 命中 `anchor-backfill` 的跨子串而非 Kubernetes RBAC，`Oracle` 命中 benchmark/testing oracle 而非数据库。
- 这些是预注册的个人回归控制，不是通用 benchmark；错误率只描述该语料与该控制集。

false-verification 按生产显示语义：融合 top1 概率 `>=0.5` → `inject`，错误候选本体将显示。`strict-any-high` 另记“池中任意候选 >=0.5”，即使它因融合 top1 低分而未显示。

| 分组 | n | false @6 | false @20 | false @50 | strict-any-high @6/@20/@50 |
|---|---:|---:|---:|---:|---:|
| 中文同域 | 20 | 9 | 11 | 12 | 10 / 11 / 12 |
| English | 10 | 9 | 9 | 10 | 9 / 10 / 10 |
| CJK | 10 | 1 | 2 | 2 | 2 / 2 / 3 |
| fixture negative | 10 | 0 | 0 | 0 | 0 / 0 / 0 |
| **合计** | **50** | **19** | **22** | **24** | **21 / 23 / 25** |

fixture negative 的 0/10 不能外推为远域安全：0 次事件、n=10 时 95% Wilson 上限约 **27.75%**。

### 3.2 失败 query 与错误候选

下表列出任一池失败的全部 24 条。候选列为 **50 池的 fused top1**；完整 6/20/50 候选、概率和所有高分候选见 `ce-results.json`。

| id | query | 误展示池 | 50 池错误 fused top1 / probability |
|---|---|---|---|
| CN01 | addEntry 白名单如何把字段同步到 Salesforce 商机记录？ | 6/20/50 | `mem_1788760998562_xzeo25` / 0.836351 |
| CN02 | created_at 在包装层是否被当作 Stripe 发票编号？ | 6/20/50 | `mem_1791178652148_joizwn` / 0.982305 |
| CN06 | LongMemEval 的 0.375 是否是 Vulkan 显存压缩率？ | 6/20/50 | `mem_1788836646433_2aa585` / 0.844206 |
| CN07 | multi-session gap 是否通过 Android Room 的迁移插件修复？ | 6/20/50 | `mem_1788836646433_2aa585` / 0.871999 |
| CN08 | R@10≈0.91 是否代表十位编辑的论文接受率？ | 20/50 | `mem_1788836646433_2aa585` / 0.972928 |
| CN11 | serve sidecar 的 kill-switch 是否通过 Discord slash command 触发？ | 6/20/50 | `mem_1789960711568_7wjeld` / 0.692618 |
| CN12 | Python kernel 的无人看管 TTL 是否硬编码为 17 秒？ | 6/20/50 | `mem_1788838727545_igpk6x` / 0.990486 |
| CN13 | worker session 复活是否由 macOS launchd 的 KeepAlive 触发？ | 6/20/50 | `mem_1791465019713_lc48pe` / 0.597640 |
| CN14 | 后台计算约束是否要求 owner 每三分钟手动发送 heartbeat？ | 6/20/50 | `mem_1791178048166_dnvkh3` / 0.985012 |
| CN15 | sidecar 健康检查失败后是否会直接删除 gateway.db？ | 50 | `mem_1789705636096_cgtc8r` / 0.963043 |
| CN16 | setIndexManagerProvider 是否把 live index 写入 Windows 剪贴板？ | 6/20/50 | `mem_1790092812824_eip69g` / 0.967834 |
| CN19 | memory-decay migration 每次保存会生成 42 份索引副本吗？ | 20/50 | `mem_1791177124326_jbmd90` / 0.936941 |
| EN01 | Which Salesforce queue receives fields dropped by the addEntry whitelist? | 6/20/50 | `mem_1788760998562_xzeo25` / 0.850632 |
| EN02 | How does rerankDetailed cache yes/no logits in PostgreSQL? | 6/20/50 | `mem_1790618949885_c6gphf` / 0.903847 |
| EN03 | Which 70B SPLADE checkpoint does T1SemanticEncoder download from Azure? | 6/20/50 | `mem_1794895467890_ceacs5` / 0.832912 |
| EN04 | Why does the unattended Python kernel use a hard-coded 17-second TTL? | 6/20/50 | `mem_1788838727545_igpk6x` / 0.997259 |
| EN05 | How does MAFW_DEV_ADOPT create an SSH tunnel through Tailscale? | 6/20/50 | `mem_1794246755980_x8xqjl` / 0.802935 |
| EN06 | Which Kafka topic exports superseded harmonic memories to Elasticsearch? | 6/20/50 | `mem_1787204687284_o4rtot` / 0.970750 |
| EN07 | How many Raspberry Pi nodes are required by the BM25 postings cache? | 6/20/50 | `mem_1794985884594_jmg9xc` / 0.887307 |
| EN08 | What Docker Compose password protects the recall snapshot verifier? | 6/20/50 | `mem_1790604154589_218elu` / 0.632218 |
| EN09 | How does resolveSupersededHeads issue OAuth tokens for GitHub? | 6/20/50 | `mem_1794971703389_ynsnem` / 0.891815 |
| EN10 | Which Firefox extension renders the MAFW note-board as a PDF? | 50 | `mem_1794921848140_qs22yi` / 0.950889 |
| CJ03 | Qwen3-Reranker が 42 台の GPU を要求する設定はどれですか。 | 20/50 | `mem_1790218981029_nyy472` / 0.850904 |
| CJ09 | マルチセッションの 0.375 はどのコーヒー抽出比を表しますか。 | 6/20/50 | `mem_1788836646433_2aa585` / 0.955390 |

早期池不同的 fused top1：

- EN03：6/20 为 `mem_1794834213033_3bx6ev`（0.679063 / 0.679869）。
- EN06：6 为 `mem_1787194923349_x6jbsk`（0.866895）；20/50 为表中的 `o4rtot`。
- EN09：6/20 为 `mem_1790125527890_iln1r4`（0.562401）。

有高分但未展示的独立诊断：6 池 CN19/CJ03，20 池 EN10，50 池 CJ06。它们没有计入实际 false-verification，但计入 strict-any-high；不能因为出口碰巧隐藏就当作 verifier 区分力合格。

## 4. Hard negative（全部来自真实 50 池）

选择 locked active candidate，均不属于 expected ids；选择理由只依据同域 metadata 是否回答该问题。没有使用正文给 CE 增加证据。

| target | hard negative id | BM25 rank | hard p | target p | 高于 target | 跨 0.5 |
|---|---|---:|---:|---:|---|---|
| field-passing | `mem_1789712104943_s7eaxc` | 3 | 0.187893 | 0.998746 | 否 | 否 |
| field-passing | `mem_1789960125200_bmirvf` | 4 | 0.477371 | 0.998746 | 否 | 否 |
| field-passing | `mem_1791169315762_xqjlsn` | 10 | **0.707849** | 0.998746 | 否 | **是** |
| multisession-gap | `mem_1788836646363_sh4p00` | 2 | **0.528951** | 0.999439 | 否 | **是** |
| multisession-gap | `mem_1791516531689_k6f1mr` | 4 | **0.899102** | 0.999439 | 否 | **是** |
| multisession-gap | `mem_1791182958623_9hpk3z` | 9 | **0.855349** | 0.999439 | 否 | **是** |
| unattended-background | `mem_1789715110014_gehspf` | 12 | 0.417377 | 0.998610 | 否 | 否 |
| unattended-background | `mem_1789702975148_gph2xf` | 37 | 0.028352 | 0.998610 | 否 | 否 |
| unattended-background | `mem_1791519286314_udz61a` | 38 | 0.000000 | 0.998610 | 否 | 否 |
| live-index-overwrite | `mem_1791173958564_ay5ki2` | 16 | 0.024425 | 0.997889 | 否 | 否 |
| live-index-overwrite | `mem_1791184840981_jz4tp8` | 34 | 0.465295 | 0.997889 | 否 | 否 |
| live-index-overwrite | `mem_1794829791463_ukltaj` | 7 | 0.033971 | 0.997889 | 否 | 否 |

结果：0/12 高于 target，但 4/12 跨阈值。即使 target 本身排名第一，候选级验证仍会把同域非答案判为高分。

## 5. 延迟与生产可行性

正式 CE 使用生产 warm sidecar，所有 batch 顺序执行。下表排除唯一空候选 CJ05；每池 53 个非空 batch，target 另列 4 个。

| 池 | 全部非空 p50 / p95 / max | target p50 / max | 判定 |
|---|---|---|---|
| live BM25 6 | 103.5 / 120.5 / 208.4 ms | 115.7 / 208.4 ms | 不能叠加到 100ms 实时边界；后台可承受 |
| live BM25 20 | 337.8 / 395.5 / 771.6 ms | 395.5 / 771.6 ms | 仅后台实验；错误更多 |
| live BM25 50 | 797.9 / 957.9 / 1442.8 ms | 957.9 / 1442.8 ms | 仅慢后台；无质量收益且错误最多 |
| snapshot-shape-6-bm25-only | 111.1 / 135.4 / 135.4 ms | 同左（n=4） | 最接近现有 snapshot verify 成本形状 |

独立进程冷启动（模型已在磁盘，非 OS-cache cold）：

- sidecar ready：4168.6ms；首次 6 条 score：5375.3ms；合计 **9543.9ms**。
- 同一独立进程随后的 6/20/50 分别为 1141.9 / 518.1 / 1221.1ms，仍有初始化/缓存升温，不能替代上面的生产 steady-warm 分布。
- 独立子进程 PID 52620 已清理；生产 sidecar 后续 health=200，进程列表只保留原 embedding/reranker 两个 sidecar。

**生产判断：**边界内联 CE 不可行；后台 6 条 verify 的计算成本可接受，但本轮安全门失败，延迟可承受不等于可以上线。20/50 既不是当前 snapshot 默认池，也没有恢复增益，反而增加误展示与单流 sidecar 占用。

## 6. 失败归因与下一步

1. **召回：不是失败点。**4/4 target 已在 rank 1，所有池都恢复。
2. **verifier 区分力：主失败。**大量错误前提只要共享主题，CE 就给出 0.6–0.997 的“相关”概率；它测到 topical relevance，却没有可靠验证“该候选是否回答这个具体前提”。
3. **阈值：当前 0.5 明显不合格，但不能在这批 held-out 上反推新阈值。**6 池最低 target top1 与最高错误 top1 的表观差仅 `0.0005387`；而同一 query/candidate 在 6/20/50 prompt batch 中观察到的最大概率范围为 `0.0085457`，比表观间隙更大。这个间隙不是建议操作点。
4. **候选池：扩大无效且有害。**恢复一直 4/4，但 false-verification 从 19 增至 24，p50 从约 103ms 增至约 798ms。
5. **只显示 top1 也不能解决。**上述 false-verification 是由错误的 fused top1 自身过阈值触发，不是仅由尾部高分候选造成。

建议顺序：

1. 保持当前 low/no 不显示，先改 verifier：把“主题相关”与“回答/支持当前具体命题”分开，加入错误前提、不同值/结果、memory-family 隔离的 hard-negative 训练和校准；必要时研究带独立证据的 answer-consistency verifier，而不是继续只看摘要 topical match。
2. 固定一个独立于本轮的新 held-out，再评估阈值和 batch 稳定性；本轮数据不得用于调参后继续宣称 held-out。
3. 保持候选池小，不进入 20/50 扩池。只有新 verifier 同时通过恢复、控制、hard negative 和延迟门，才讨论后台 verify-before-display。
4. **不把 lexical-clue 当作更安全的替代。**CE 已在词面/主题近邻上失败，弱化标签不会改变错误锚定。若研究需要比较，可做默认 off 的 lexical-clue shadow，但不自动给 pointer、不上准入、不改 AUTO hit 口径。

## 7. 可复现脚本与原始产物

目录：

`C:\Users\15524\AppData\Local\Temp\opencode\verify-before-display-20261118-k31\`

| 文件 | 内容 |
|---|---|
| `collect-baseline.cjs` / `baseline.json` | live FOK/AUTO、边界重放、expected state、控制筛选元数据 |
| `collect-live-pools.cjs` / `pools.json` | 首次 CE 前冻结的 live BM25 top50 候选 |
| `controls-draft.json` | 预声明控制 query 与 distinctive terms |
| `lock-experiment.cjs` / `experiment-lock.json` | 50 控制与 12 hard negative 的 CE 前锁 |
| `run-ce.cjs` / `ce-results.json` | 166 个 batch 的所有输入序概率、CE/fused rank、zone、延迟 |
| `run-cold-latency.cjs` / `cold-latency.json` | 独立进程冷启动与清理证据 |
| `verify-results.cjs` / `summary.json` | 概率对齐、融合排名、zone、锁和索引完整性独立校验 |
| `run-ce.log` / `verify-results.log` | 执行日志 |
| `snapshot/memory/.harmonic_index.json` | 只读冻结索引副本 |

复用已冻结输入重跑：

```powershell
cd C:\Users\15524\AppData\Local\Temp\opencode\verify-before-display-20261118-k31
node run-ce.cjs
node run-cold-latency.cjs
node verify-results.cjs
```

全新复现需在新的 `verify-before-display-*` 目录依次运行 `collect-baseline.cjs`、`collect-live-pools.cjs`、`lock-experiment.cjs`，再运行上述三项；collector 故意拒绝覆盖已有冻结索引。

独立校验结果：166 行结果、概率范围/输入对齐、融合排名、zone、锁哈希、无 `memory_value`、生产索引未变均通过。新增生产测试 **0**；未运行全量生产测试（只读研究、无生产代码改动）。未 commit。
