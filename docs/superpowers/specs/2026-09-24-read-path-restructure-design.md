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
| **bm25 + Qwen3-Reranker（R3 验证层）** | **0.657** | **0.892** | **0.750** | **0.900** |

**结论：加验证层（CA1 匹配-失配）优于再加检索通道（dense）。** dense 一涨一跌（拉入语义相近但缺关键信息的干扰项），验证层只涨不跌。

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

### R1 期望生成（PFC）—— 待做
- **内容**：检索前构造"期望"——问句 → "记忆会怎么写"（查询改写）；实体扩展/消歧；时间归一；**情境重现**（session/goal/近因作 cue）。
- **目标类型**：multi-session（需分解）、temporal（需时间归一）、knowledge-update。
- **约束**：同步路径不能上 LLM（100ms）→ 规则优先；LLM 改写只走显式路径。
- **可测**：对 multi-session/temporal 子集做 A/B。

### R2 双过程级联 —— 待做
- **内容**：把 dense/BM25 **并联 RRF → 串联**：熟悉感（dense/gist）先粗筛候选 → 回忆（BM25+图）精验排序。
- **或**：条件化融合（dense 只在低词面重叠时加权，保护精确类型）。
- **依据**：测量显示固定权重 RRF 一涨一跌。

### R4 竞争抑制（提取诱发遗忘）—— 待做
- **内容**：候选按语义簇分组，簇内选胜者、压制其余（demote/dedup）。
- **目标**：knowledge-update（旧值 vs 新值竞争）、减少"相似项并列"。
- **可测**：簇内 top-1 保持率。

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
