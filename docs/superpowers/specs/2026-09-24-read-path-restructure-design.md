# 读路径重构：从「打分 → top-k」到「期望 → 补全 → 验证 → 竞争 → 重构」

> 日期：2026-09-24（2026-09-27 调研修订）· 状态：R3 已实现并验证；R1/R2/R4 实测否决；R6/R5/R7/R8 已调研待实现
> 范围：把记忆**读路径**（检索/取回/注入）按大脑方式重构
> 依据：本次 LongMemEval 测量 + 大脑读路径调研（`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.4/1.5）
> + 读路径专项调研（`docs/research/2026-09-27-read-path-brain-alignment.md`，FOK/上下文复原/线索抽取/预测预取四方向）
> 相关：`2026-09-24-write-time-routing-design.md`（写路径 S1，读路径是其对偶）

## 1. 背景与测量

### 1.1 实测：瓶颈是排序，不是召回
LongMemEval-S（120 题，session 粒度，bm25 + graph + coactivation + channelSplit）：

| 类型 | R@1 | R@10 | R@10−R@1 |
|---|---|---|---|
| single-session-assistant | 1.000 | 1.000 | 0.000 |
| single-session-user | 0.900 | 1.000 | 0.100 |
| knowledge-update | 0.450 | 1.000 | **0.550** |
| temporal-reasoning | 0.429 | 0.829 | 0.400 |
| multi-session | 0.377 | 0.890 | **0.513** |
| single-session-preference | 0.250 | 0.800 | **0.550** |
| **overall** | **0.568** | **0.920** | 0.352 |

**R@10 0.92 → 答案几乎总在候选集里；R@1 0.57 → 排不上第一。** 最弱三类都是"查询与记忆词面不重叠"。

### 1.2 对照实验
| 方案 | overall R@1 | NDCG@1 | preference R@1 | user R@1 |
|---|---|---|---|---|
| bm25 | 0.568 | 0.792 | 0.250 | 0.900 |
| hybrid（+dense） | 0.586 | 0.817 | 0.450 | 0.800 ↓ |
| hybrid + reranker | 0.622 | 0.858 | 0.650 | 0.800 ↓ |
| **bm25 + Qwen3-Reranker（R3 验证层）** | **0.657** | **0.892** | **0.750** | **0.900** |

**结论：加验证层（CA1 匹配-失配）优于再加检索通道（dense）。** dense 一涨一跌（拉入语义相近但缺关键信息的干扰项）；**有验证层时 dense 净负**（hybrid+rerank 0.622 < bm25+rerank 0.657）→ **R2（双过程级联/dense 融合）实测否决，不做**。

## 2. 大脑读路径（目标模型）

**核心命题：大脑不做全库扫描；取回 = 线索触发的重构。**

| 阶段 | 脑机制 | 文献 |
|---|---|---|
| ① 期望生成 | PFC efference copy（"我在找什么"）+ 编码特异性（情境重现） | Norman & O'Reilly 2003；Tulving & Thomson 1973 |
| ② 模式补全 | CA3 吸引子（部分线索 → 完整集群） | Nakazawa 2002；Rolls 2013 |
| ③ 双过程 | 熟悉感（快/gist）→ 回忆（慢/精确），**串联** | Yonelinas 2002 |
| ④ 匹配-失配验证 | CA1 比较器（候选 vs 期望 → 预测误差） | Vinogradova 2001；Percept Mot Skills 2021 |
| ⑤ 竞争抑制 | 提取诱发遗忘（选出胜者、压制竞争项） | Anderson 1994 |
| ⑥ 重构 | 图式偏置的主动重构 | Bartlett 1932；Schacter 2007 |

## 3. 现状 vs 目标

| 阶段 | MAFW 现状 | 判定 |
|---|---|---|
| ① 期望生成 | 原始 query 直投 BM25 | ❌ |
| ② 模式补全 | anchor + coactivation 图 + 有界 PPR | ✅ |
| ③ 双过程 | dense/BM25 **并联 RRF** | ◐ |
| ④ 验证 | **R3：Qwen3-Reranker（已实现+验证）** | ✅ |
| ⑤ 竞争抑制 | 无（并列打分） | ❌ |
| ⑥ 重构 | C0 回源重建 | ✅ |

**约束**：边界 recall（`/api/recall/context`）有 **100ms 硬契约**（插件 100ms abort）。R3 验证层（~250ms）**不能**进同步边界路径——只能进显式检索路径（`mafw_search_hybrid`）或异步预计算快照。

## 4. 切片

### R3 验证层（CA1）—— ✅ 已实现并验证
- **实现**：`gateway/src/core/memory/llamacpp-reranker.ts`——Qwen3-Reranker-0.6B GGUF 经 llama.cpp `/v1/completions` + **yes/no logprob** 打分（Qwen3ForCausalLM 不是 seq-cls，走不了 text-classification pipeline；llama.cpp `/rerank` 对它无区分度）。官方模板 + 空 think 块禁用思考。
- **测量**：R@1 +0.089、NDCG@1 +0.100、preference +0.50、user 不掉。
- **待接线**：config `search.reranker: 'llamacpp'` + 显式检索路径；边界路径不接。
- **坑**：`createReranker('llamacpp')` 默认 CPU（19s）→ 必须 `gpu: 'vulkan'`（250ms）。

### R1 期望生成（PFC）—— ❌ 实测否决（LLM 查询改写版）
- **实现**：harness `--queryRewrite`（用 worker 模型把问句改写成"记忆会怎么写"的陈述式查询，如 "Where did I attend my cousin's wedding?" → "user cousin wedding location"）。
- **实测**（111/120，bm25+reranker+rewrite）：overall R@1 **0.615 < 0.657**（无改写）；preference 0.750→0.650（↓）、其余持平。
- **结论**：**有验证层时查询改写净负**——验证层已直接读 query×候选桥接"问句↔陈述"，改写反而给 BM25 候选集与判官加噪。**R1（LLM 改写）不做**；若做，只考虑规则式时间归一（待验证）。

### R2 双过程级联 —— ❌ 实测否决（不做）
- **实测**：hybrid+rerank (R@1 0.622) **低于** bm25+rerank (0.657)；有验证层时 dense 全面净负（user 0.90→0.80、preference 0.75→0.65）。
- **结论**：验证层已覆盖语义匹配；dense 只往候选集塞"语义相近但缺关键信息"的干扰项。**R2 不做**。

### R4 竞争抑制（提取诱发遗忘）—— ❌ 实测否决（近因竞争版）
- **实现**：重排融合加近因项 `score = base·bm25 + base·ce + w_recency·recency`（`MAFW_RERANKER_RECENCY`/`recencyWeight`，默认 0 = R3 基线）。
- **实测**（w=0.2，120 题）：overall R@1 **0.644 < 0.657**；knowledge-update 0.450→0.475（↑）但 user 0.900→0.850、preference 0.750→0.700（↓）。
- **结论**：**近因竞争净负**（与 HeuristicReranker 近因零增益一致）。**R4 不做**。

## 切片实测总结

| 切片 | 结果 | 判定 |
|---|---|---|
| R1 查询改写（LLM） | 0.615 < 0.657 | ❌ 否决 |
| R2 双过程级联（dense） | 0.622 < 0.657 | ❌ 否决 |
| R3 验证层（Qwen3-Reranker） | **0.657**（+0.089） | ✅ **唯一已验证** |
| R4 近因竞争 | 0.644 < 0.657 | ❌ 否决 |
| R6 上下文复原 | 待实现（调研证据最强：CueMem/EdgeMem/EM-LLM） | → 见 §5 |
| R5 FOK 元记忆门 | 待实现（防臆造结构防线） | → 见 §5 |
| R7 确定性线索抽取 | 待实现（标识符分词 + 逐字加权） | → 见 §5 |
| R8 预测预取快照 | 待实现（延迟优化，非质量优化） | → 见 §5 |

**结论修正（2026-09-27）**：R1–R4 的结论是"验证层是打分-排序阶段唯一有效的重构"，但**"剩余弱类型非检索层可修"的判断被新调研推翻**——CueMem（去图扩展 81.1→71.4）与 EdgeMem（episode 通道 +8.4）证明**命中锚点的时间邻居扩展**直接作用于 temporal/multi-session/knowledge-update 三类弱项。脑机制依据：lag-CRP（Kahana 1996）、TCM 上下文复原（Howard & Kahana 2002）、语义与时间信号可加（Polyn et al. 2009）。

### R6 情景上下文复原（temporal neighbor bundling）—— 待实现，**证据最强**
- **依据**（详见调研 §2）：lag-CRP 效应（Kahana 1996）；CueMem 去扩展 81.1→71.4；EdgeMem episode 通道 +8.4；EM-LLM contiguity buffer（须 ≤ similarity buffer）。
- **实现**（检索出口层，`harmonic-index.ts` 或 `search-hybrid.ts`）：
  1. BM25 命中（分超 floor）为锚点 → 捆绑同 session ±1 条目（对称窗，w∈{1,2} 在 LongMemEval 上调）；
  2. 锚点为 session 首/尾时，桥接时间相邻 session 的边缘 1 条；
  3. 呈现：时间序成块、`[日期, session]` 前缀、锚点标 ▶、邻居 token ≤ 50% 预算、去重；
  4. 知识更新：保留全部版本 + 指令"优先采用离问题时间最近的信息"（CueMem 消融值 +6.4/+6.8）+ 显式标记 supersede 链头；
  5. **绝不物理排除旧版本**（"X 什么时候变的"类问题需要）。
- **评测**：LongMemEval per-category，预期增益集中在 temporal / multi-session / knowledge-update。
- **坑**：误命中锚点的邻居 = 误上下文 → 只扩展高分锚点；硬 token 帽防膨胀（CueMem ~2K 重构 > 108K 全史）。

### R5 FOK 元记忆门（PFC 监控）—— 待实现
- **依据**（调研 §1）：mPFC 损伤 = 自信虚构（Schnyer 2004）；LLM 自报置信无效（2605.24299）→ **门必须在检索代码里**；prompt 式弃答在误导上下文下崩溃（2608.22228）；便宜信号够用（2501.12835）。
- **实现**（`/api/recall/context` + `mafw_search_hybrid` 出口）：
  1. 特征 = reranker top1 概率 + top1−top2 margin（**用未经 energy×salience 加权的原始相关性分**）；
  2. isotonic 校准（LongMemEval 日志做校准集）；
  3. 三区：正常注入 / top1+低置信包装 / **显式注入 `<recall status="no-reliable-memory">` 块**（沉默是错的）；
  4. supersede 链解析先于 margin 计算（新旧成对压低 margin）。
- **阈值**：非对称目标（错记忆重罚、漏记忆轻罚）。

### R7 确定性线索抽取 —— 待实现（低优先级）
- **依据**（调研 §3）：确认 R1 否决（CAsT 自动改写比人工差 35%）；query reduction > expansion（Kumaran & Allan 2008）；编码特异性——逐字 token 必在写入 trace 里。
- **实现**：① 标识符感知分词（camelCase/snake 双索引，效应量最大，arXiv:2605.18561）；② 抽取路径/标识符/引号串/日期 → 2–3× **加性**加权（永不减性过滤）；③ 分词变更后必须重跑 LongMemEval 基线（IDF 会移动）。
- **前置检查**：写路径 `primary_abstraction` 是否保留逐字标识符。

### R8 预测预取快照 —— 待实现（最低优先级，延迟优化）
- **依据**（调研 §4）：preplay（Dragoi & Tonegawa 2011）；predictive prefetching −43.5% 延迟（2605.17989）；**最后一轮只含 session 词汇 36%**（2607.22392）→ 快照 query 用滚动 N 轮 + goal 快照 + 活跃文件。
- **实现**：kv_store `recall-snapshot/{sessionID}`（top-N + 预格式化块 + queryHash）；后台刷新（回合完成防抖 / goal 变更 / 话题转移）；边界读快照 ~1ms，增量 >50 字符时跑正常搜索并**新鲜结果在前**合并；快照构建走 `resolveSupersededHeads`；话题转移检测确定性做在 gateway（LLM 会带陈旧上下文，2605.09268）。
- **定位**：只解决 100ms 边界契约的覆盖问题，不提升 R@1。

## 5. 优先级与依据（2026-09-27 修订）

1. **R6 上下文复原**（调研证据最强，直击 temporal/multi-session/knowledge-update 三大弱项；呈现指令部分零风险）。
2. **R5 FOK 门**（防臆造结构防线；脑机制对应最清晰）。
3. **R7 线索抽取**（安全加性，先查写端保真）。
4. **R8 预测预取**（只优化延迟）。
5. ~~R3 接线~~（已完成）；~~R1/R2/R4~~（已实测否决）。

## 6. 非目标

- 不做全库 LLM 扫描（守 100ms 边界）。
- 不改 OKF 存储。
- 不引入外部 API（验证层用本地 GGUF）。

## 7. 涉及文件

- R3：`gateway/src/core/memory/llamacpp-reranker.ts`（新）、`reranker.ts`、`config.ts`（`search.reranker: 'llamacpp'`）、`mcp/handlers/search-hybrid.ts`、`index.ts`
- R6：`gateway/src/core/memory/harmonic-index.ts`（检索出口扩展）、`inject-format.ts`（邻居块呈现）、`recall-context.ts`
- R5：`gateway/src/mcp/handlers/search-hybrid.ts`、`routes/recall-context.ts`（三区门 + 校准）
- R7：`gateway/src/core/memory/harmonic-index.ts`（tokenizer 双索引）、query 预处理
- R8：kv_store `recall-snapshot/{sessionID}`、`routes/recall-context.ts`、回合完成钩子
