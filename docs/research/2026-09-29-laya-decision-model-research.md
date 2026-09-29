# Laya（System One 决策模型）调研：与 MAFW 记忆系统 / Reranker 的结合点

> 2026-09-29。信息源：github.com/NandhaKishorM/laya（README 全文 + Honest limits + Jev 对比表）、
> arXiv:2609.30706（LAVOIR，Laya 的 VOI 扩展）、arXiv:2609.28940（Jev/Laya 用于 pentest harness 的决策层分析）、
> 本地 typesafe-ai skill（TypeSafe Jev 概念文档）。
> 所有 Laya 侧数字均为其自报基准（T4 GPU），未在我们数据上复测——按惯例：**先影子测量，再谈采用**。

## 0. TL;DR

**Laya 是什么**：非自回归 "System One" 决策引擎——对任意 state（文本/JSON）在**单次前向**里回答类型化问题
（`choice` 多选一 / `noul` 是非概率 / `score` 有序等级），输出**校准概率**而非生成文本。33ms/问（T4）、
批量 7.2ms/问、Apache-2.0、自托管。是 TypeSafe Jev 的开源对应物（HTTP wire 协议兼容，`POST /v1/systemone`）。

**对我们最重要的三个事实**：

1. **零样本 ≈ 随机**。Laya 自己的 Honest limits：在陌生的 typed-decisions 基准上，base checkpoint
   0.362/0.352（随机 0.318、多数类 0.461）——"Laya is a fast base to specialise, not a zero-shot
   decision engine"。微调后 0.766（超过 Jev 0.727 和教师自一致性 0.735）。
   → **任何接入点都必须先影子模式收集一致性数据，微调后才可能超越现有信号**。
2. **中文必须走 multilingual checkpoint**。English checkpoint 在非拉丁文字上会**自信地全错**
   （高棉语 0.000 准确率 @ 0.952 置信度——"confidence gating cannot save you"）。
   mmBERT-base multilingual：XNLI 非英语 14 语 0.731、MASSIVE 非英语 0.451，且**出厂未拟合温度**（raw ECE 0.314，
   拟合后 0.106）。我们的记忆语料以中文为主 → 固定 multilingual，概率需谨慎对待。
3. **它不是 reranker 的替代品**。Laya 的 RAG relevance（MS MARCO）只有 0.625–0.658，远弱于
   Qwen3-Reranker 在我们栈里的实测贡献（R2+R3：R@1 0.655→0.673）。两者是**互补轴**：
   reranker 回答"这篇文档多相关"（单文档、连续分数），Laya 回答"这组上下文里能找到答案吗"（集合级、类型化判断）。

**推荐结论**（详见 §3）：
- **P0：ConsolidationService 裁判级联**——唯一同时满足"高_volume + 已有标注源 + fail-open 就位 + 中文可走 multilingual"的接入点。
- **P1（研究向）：FOK 特征集成**——set-level answerability 作为第二特征与 reranker top1prob 集成，冻结 `_abs` 集上测 AUROC。
- **P1.5：审批破坏性命令判定**——补 AGENTS 记录在案的"bash 无法按命令内容过滤只读"缺口。
- **明确不做**：边界 serve 路径任何环节（33ms 不符合 100ms 契约的剩余预算）、快照话题判定（词面包含度已实测有效）、
  reranker 替换/前置过滤（BM25 已是廉价前置层）。

## 1. Laya 技术要点

### 1.1 架构与产物

```
[CLS] choice question: <instruction> [SEP]
[MASK] <option 1>: <description> [MASK] <option 2>: ... [SEP]
<state: 文本/JSON/多轮> [SEP]
```

- 每个 option marker 的 hidden state 打分，softmax + 拟合温度 → 概率分布（`choice`）
- `noul` = P(yes)（是非）；`score` = 有序等级上的概率加权位置（**最弱原语**，multilingual 有位置偏置）
- RLCD 训练（严格正常计分规则做 reward）→ 概率统计上有意义；ECE（温度拟合后）english 0.081 / multilingual 0.106
- `answer_confidence`（= max p）是唯一该门控的量；`confidence`（1−归一化熵）只反映分布集中度，**不能**当 Jev 阈值迁移
- `min_confidence=` 显式弃权（低置信标记 `low_confidence: true`；`decide()` 返回 None）——级联设计的现成钩子

### 1.2 三个 checkpoint + Router

| checkpoint | encoder | 参数 | 上下文 | 用途 |
|---|---|---|---|---|
| `laya` | ModernBERT-large | 421M | 512 | 英语 |
| `laya-multilingual` | mmBERT-base | 322M | 1024（可 8192） | 100+ 语言，2x 快 |
| `laya-typed-decisions` | ModernBERT-large | 421M | 1024 | 微调示范（0.766） |

Router 按文字/语言 <0.5ms 分流；**中文语料固定 multilingual，不要依赖 router 猜**。

### 1.3 部署面（与我们的 sidecar 模式对齐）

- `pip install laya[serve]` → `laya-serve`，`POST /v1/systemone`（**Jev wire 兼容**），`LAYA_DEVICE=cuda LAYA_MODELS=multilingual LAYA_PORT=…`
- ONNX extra（INT8 量化，CPU 部署）；`laya-ts`（npm，Node/浏览器——README 未给细节，待验证）
- MCP server extra（stdio，8 工具）；hooks：`on_predict_start/end` 可做 PII 脱敏（我们已有 `redactSecrets()`，客户端侧等价）
- CPU 单问 193–464ms（torch preload）→ **CPU-only 不可用于任何交互路径，需 GPU sidecar**（与 embedding/reranker 同格局）

### 1.4 诚实限制（直接引用其文档，全部与接入设计相关）

- **>20 options 崩**：Banking77 77 标签 0.425（Jev 0.870）——每标签只剩 3–4 token。>20 候选用 `predict_shortlist`
  （调用方嵌入先筛 top-k 再单次前向）或粗细分层
- **否定不安全**：#377——`no_action`/`cancel_account` 这类否定式标签，4/4 否定请求被选了 `cancel_account`（p=0.9998）。
  → 问题设计必须正向措辞，选项描述用肯定语义
- **零样本弱**（见 TL;DR #1）；微调规模参考：~30k 问题、2xT4 4–5 小时；单卡 16GB 可完成一次完整特化
  （其 browser-agent 示例：top-1 0.10→0.66，17–23ms/step）
- 微调后温度按 question type 重拟合；校准样本来自训练集时必须在独立 held-out 上评估

### 1.5 与 Jev（TypeSafe）的关系

| 维度 | Jev 1.13.0（第三方发表，未复测） | Laya (routed) |
|---|---|---|
| typed-decisions 2,000 决策 | 0.727 | **0.766**（微调后） |
| >20 options | **0.870** | 0.425 |
| ECE（拟合后） | 0.246 | **0.081** |
| p50 延迟 | 236–276ms | **32.8ms** |
| 权重 | 闭源 API | **Apache-2.0** |
| 成本 | $0.042/1M tokens | $0 自托管 |

我们本地-first 的 sidecar 格局（embedding/reranker 均 llama.cpp 本地）天然倾向 Laya；
Jev 保留为高基数选项场景的备选（本地 typesafe-ai skill 可随时接）。

## 2. MAFW 现有判定点盘点 × Laya 适配分析

按"当前实现 / volume / 延迟预算 / 适配判定"过一遍全部语义判定点：

| # | 判定点 | 当前实现 | volume | 延迟预算 | 判定 |
|---|---|---|---|---|---|
| 1 | ConsolidationService UPDATE/CREATE 裁判 | worker LLM（qwen3.7-max），cosine≥0.8 候选触发，判官不可达 fail-open | 每次记忆写入（有候选时） | 后台秒级可 | **✅ P0** |
| 2 | FOK 三区门特征 | reranker top1prob（弃权判别 AUROC 0.782；bm25 比值仅 0.582） | 每次检索（快照后台 + live） | live 路径 70/100ms 已用 | **⚠️ P1 研究向** |
| 3 | 审批：命令破坏性判定 | `isReadOnlyTool` + 正则 allowlist + 三档策略（25 次预算回落） | auto 模式每次 permission ask | 交互秒级可 | **✅ P1.5 补缺口** |
| 4 | MinHash 合并二次意见 | MinHash 0.7 段级相似 | 写入时 ≥0.7 相似 | 后台 | ⚠️ 可选 |
| 5 | turnCompress "值得记忆"预过滤 | worker LLM 全量判断 | 每会话每小时 | 后台 | ⚠️ 中等 |
| 6 | reranker 降级兜底 | HeuristicReranker（实测零增益） | 仅 sidecar 挂时 | n/a | ❌ 弱 |
| 7 | 快照话题漂移 | 词面包含度 ≥0.25（实测 Jaccard 有长度偏置后修正） | serve 路径（3ms 总） | ~0ms | ❌ 不做 |
| 8 | triage 提议 / 自动化结果分级 | LLM 建议 | 低 volume | 分钟级 | ❌ 不值得 |
| 9 | 模型路由 `mafw_get_model_route` | 预算确定性策略 | 每 goal 循环 | — | ❌ 是策略不是语义 |
| 10 | LAVOIR VOI："该不该问用户" | manager LLM 自决 | 低 | — | ⏸ 搁置（需 slot 工程） |

### 2.1 P0：ConsolidationService 裁判级联（写路径成本 + 标注源双重收益）

**现状**：每次记忆写入，cosine≥0.8 的旧候选交给 worker LLM 判 UPDATE/CREATE，UPDATE 走 soft-supersede。
这是写路径上唯一按次计费的 LLM 调用，且 update ratio 健康区间 16–22% 已有 `/api/memory/stats` 观测。

**方案**（级联，非替换）：
```
写入 → cosine≥0.8 候选 → Laya choice {update_old, create_new, unrelated}
                              ├─ answer_confidence ≥ τ_high → 直接采纳
                              ├─ answer_confidence ≤ τ_low  → 直接放弃（省 LLM）
                              └─ 中间带 → 升级 worker LLM（现行路径）
```
- LLM 裁判的裁决**本身就是蒸馏标签**：影子期收集 (new, old, LLM_verdict) 三元组 → 直接构成微调集
  （其微调闭环：RLCD + 温度拟合 + held-out ECE，Kaggle 2xT4 量级即可跑）
- 问题设计注意（§1.4）：选项正向措辞（`supersedes_old` / `distinct_fact` / `unrelated`），
  state 用 redactSecrets 后的 `{new_memory, old_memory}` 结构化字段
- **度量计划**（先影子后灰度）：影子期一致率 / 分歧样本分析 / 灰度后 update ratio 是否维持 16–22% 健康带 /
  LLM 调用削减率 / held-out ECE
- 中文记忆 → multilingual checkpoint，**先只测不裁**（出厂无拟合温度，概率先当序数用）

### 2.2 P1：FOK 特征集成（与 reranker 的真正互补轴）

**现状**：R5 弃权判别靠 reranker top1prob（单文档相关性概率），AUROC 0.782。但 FOK 语义其实是
**集合级可答性**："这 top-k 上下文里能不能找到答案"——这是类型化判断（`noul`），正是 Laya 的形状，
而 reranker 天生不回答这个问题。

**方案**：冻结 LongMemEval `_abs` 集（30 题）+ 按 `_abs` 构造法从 haystack 扩充弃权问题（冻结样本，防漂移），
影子跑三个特征臂：`top1prob`（现状）/ Laya `noul(query, top-k)` / 二者集成，比 AUROC。
**只有显著优于 0.782 才进快照构建器**（后台路径，无边界延迟压力）。

### 2.3 P1.5：审批破坏性命令判定（补记录在案的缺口）

AGENTS §5.13b 记录："bash 不开（opencode 权限 per-tool，无法过滤只读命令），plan B（gateway 侧确定性路径探测）
记录在案未实施"。命令文本以英语为主 → english checkpoint。
`noul "does this command modify state outside the workspace?"` on `{command, cwd, tool}`。
零样本不可靠（§1.4 #1）→ 需先构造标注命令集（我们自己的 bash 历史轨迹就是语料源）。
-auto 模式 25 次预算下，这可以把"危险正则 human"升级为"语义判定 + 正则双门"。

### 2.4 reranker 关系澄清（为什么不是替代/前置）

- **不替代**：Laya RAG relevance 0.625–0.658 ≪ Qwen3-Reranker 实测贡献（R@1 0.655→0.673，NDCG@1 0.917）。
  跨编码器相关性是专精任务，决策模型不碰。
- **不前置**：边界路径刚从 240ms 修到 70ms（R8），在 BM25 和 reranker 之间插 33ms 模型是反向操作；
  BM25 本身就是那个"廉价前置过滤层"。
- **互补**：§2.2——集合级可答性判断是 reranker 不覆盖的轴。
- **降级兜底弱**：sidecar 挂时 HeuristicReranker 零增益，Laya（0.625 相关性）作 ranker 也勉强——
  真正的兜底是 watchdog 重启（已就位），不值得为此加一条链路。

### 2.5 明确不做的（防 scope creep）

- **边界 serve 路径任何环节**：33ms 超出剩余预算（~30ms），且快照已把服务压到 3ms——收益为零。
- **话题判定替换词面包含度**：包含度实测修正过（Jaccard 长度偏置），纯词面 ~0ms，无可争议。
- **模型路由 / triage 分级**：低 volume 或本质是策略而非语义，ROI 不成立。
- **LAVOIR VOI（问什么）**：概念上映射 `mafw_ask_user`，但需要 slot 工程化 + 微调，
  等级联闭环（P0）跑通后再评估。

## 3. 落地架构（若 P0 立项）

```
gateway (TS)                                laya-serve sidecar (Python venv, GPU)
ConsolidationService                          LAYA_DEVICE=cuda
  └─ laya-client.ts (HTTP /v1/systemone)  →   LAYA_MODELS=multilingual
     singleton + 2s timeout + fail-open       LAYA_PORT=13129
                                               （与 embedding :13123 / reranker :13128 同格局：
                                                windowsHide spawn / watchdog / 健康探测）
```

- 复用现有 sidecar 运维剧本（spawn 契约、windowsHide、watchdog、单例、fail-open）——零新运维模式
- 客户端侧 `redactSecrets()` 后再发（等价其 server hooks 的 PII 脱敏）
- config：`consolidation.laya { enabled, url, model, tauHigh, tauLow, shadow }`（shadow=true 只记不裁）
- 观测：`/api/memory/stats` 增 laya 裁决计数 + 一致率 + 升级率；PipelineHeartbeat 记录

## 4. 风险表

| 风险 | 证据 | 缓解 |
|---|---|---|
| 零样本≈随机，直接上线必翻车 | 官方 Honest limits（0.36 vs 0.32 随机） | 影子模式起步，只收集不裁决 |
| multilingual 出厂未拟合温度 | raw ECE 0.314 | 影子期把概率当序数；微调时按 type 重拟合温度 |
| 中文准确率无公开数字 | README 只有聚合（XNLI 非英 0.731）；zh 专项基准（feishu_zh / zh_short_commands）未发布准确率 | 影子期用我们自己的 LLM 裁决做真值 |
| 否定式问题措辞翻车 | #377（p=0.9998 选错） | 问题设计规范：正向措辞 + 肯定语义选项 |
| CPU-only 部署过慢 | 193–464ms/问 | GPU sidecar（已有 CUDA 环境） |
| 微调数据量门槛 | 官方 ~30k 问题 | LLM 裁判蒸馏 + 历史回放；不足则维持级联（不确定升级 LLM） |
| 我们 GPU 显存竞争 | embedding(CUDA) + reranker(Vulkan) 已占 | mmBERT-base 322M bf16 ~0.7GB，可行 |

## 5. 参考与后续

- Laya repo：github.com/NandhaKishorM/laya（BENCHMARKS.md 有 51 语言明细，zh 数字待查证）
- LAVOIR（VOI 扩展）：arXiv:2609.30706，github.com/moganai/lavoir
- Jev/Laya 决策层分析（pentest harness）：arXiv:2609.28940
- TypeSafe 概念文档：docs.typesafe.ai（本地 typesafe-ai skill）；级联模式参考其 "extraction cascades" cookbook
- 下一步（若立项）：brainstorming → writing-plans 出 TDD 计划（影子模式切片先行）
