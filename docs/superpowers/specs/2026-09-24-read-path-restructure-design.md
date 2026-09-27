# 读路径重构：从「打分 → top-k」到「期望 → 补全 → 验证 → 竞争 → 重构」

> 日期：2026-09-24 · 状态：R3 已实现并验证，R1/R2/R4/R5 待做
> 范围：把记忆**读路径**（检索/取回/注入）按大脑方式重构
> 依据：本次 LongMemEval 测量 + 大脑读路径调研（`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.4/1.5）+ CA1 比较器/PFC-海马比较器文献
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
| R3 验证层（Qwen3-Reranker） | **0.657**（+0.089） | ✅ **唯一有效** |
| R4 近因竞争 | 0.644 < 0.657 | ❌ 否决 |
| R5 检索监控 | 待做（低成本结构项） | — |

**结论**：**验证层（CA1 匹配-失配）是读路径唯一有效的重构**——它强到把 dense、查询改写、近因竞争全部吸收/压倒。剩余弱类型（multi-session 0.39 / temporal 0.45 / knowledge-update 0.45）**非检索机制可修**——答案深埋于会话内、会话表面（abstraction）与查询词面不匹配，属**粒度/推理限制**，需更深的多跳/时间推理（超出本 spec）。

### R5 检索监控/停止（PFC）—— 待做
- **内容**：agent 迭代路径（`mafw_search_hybrid`）接饱和判据 + 预算（GuidedRetriever 已有雏形，未接线主工具）。
- **依据**：HippoRAG 证明单步 PPR 媲美迭代；监控用于"何时停"。

## 5. 优先级与依据

1. **R3 接线**（低成本、已验证增益）——把验证层接进 gateway 显式检索路径。
2. **R1 期望生成**（剩余弱项最大杠杆：multi-session/temporal/knowledge-update）。
3. **R4 竞争抑制**（knowledge-update）。
4. **R2 双过程级联**（结构，需 R1/R3 后评估是否还需要）。
5. **R5 监控**（低成本收尾）。

## 6. 非目标

- 不做全库 LLM 扫描（守 100ms 边界）。
- 不改 OKF 存储。
- 不引入外部 API（验证层用本地 GGUF）。

## 7. 涉及文件

- R3：`gateway/src/core/memory/llamacpp-reranker.ts`（新）、`reranker.ts`、`config.ts`（`search.reranker: 'llamacpp'`）、`mcp/handlers/search-hybrid.ts`、`index.ts`
- R1：`gateway/src/recall/`（查询构造）、`recall-context.ts`
- R4：`gateway/src/core/memory/harmonic-index.ts`（检索出口）
- R5：`gateway/src/mcp/handlers/search-hybrid.ts`、`retrieval/guided-retriever.ts`
