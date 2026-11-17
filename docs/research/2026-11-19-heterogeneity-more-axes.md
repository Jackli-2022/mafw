# 还有哪些“不一样”：异质性轴与溯源缺口

> 2026-11-19。承接 `2026-11-19-generalization-slices.md`：类型/语言/来源之外，又查了 authority、边界来源、
> 时间、以及 embedding 溯源。结论：**应该谨慎，而且有一个比参数更基础的问题——我们分不清原子是哪个模型产的。**

## 1. 权威来源（authority）：接地率差 10 倍

| authority | 条目 | 精确接地 | hint | 说明 |
|---|---:|---:|---:|---|
| legacy | 4,832 | **0 (0%)** | 54 (1.1%) | 历史条目，没有 trace |
| pipeline | 616 | **338 (54.9%)** | 173 | 反思/巩固写入 |
| agent | 11,035 | **570 (5.2%)** | 1,958 (17.7%) | worker 写入 |
| user | 20 | 0 | 0 | 手工 |

读法：如果验证集按条目随机抽，**pipeline 条目会被严重高估**（它们 55% 有精确接地），
而 agent/legacy 条目几乎没有。按 authority 分层是必须的，否则 AUC/接地率都不可比。

## 2. Episode 边界来源：20% 是推断的

| boundary | 数量 |
|---|---:|
| session_end / idle_timeout | 1,691 |
| inferred / topic_shift | 314 |
| session_start / session_start | 237 |
| inferred / intent_shift | 158 |
| max_length | 1 |

读法：约 **20% 的 episode 是推断边界**。它们的成员构成、长度、intent 质量与声明边界不同；
episode 级评估必须把 `boundary_source` 当切片，不能混在一起。

## 3. 时间漂移：atoms/turn 从 1.23 到 1.55 再回 1.38

| 月份 | turns | atoms/turn |
|---|---:|---:|
| 2026-08 | 501 | 1.23 |
| 2026-09 | 556 | 1.44 |
| 2026-10 | 1,815 | 1.55 |
| 2026-11 | 1,654 | 1.38 |

读法：跨月变化 26%。可能是语料变化，也可能是模型/配置变化；**时间必须作为切片**，不能假设平稳。

## 4. 更基础的问题：embedding 溯源不清

- `~/.config/mafw/config.yaml`：`embedding.provider: local`、`engine: llamacpp`。
- 但 `config.memory.embedding.model` 的默认值是 `onnx-community/Qwen3-Embedding-0.6B-ONNX`；
  `/api/memory/stats` 的 `embedding.model` 直接读这个字段 → **页面显示 ONNX，实际跑的是 llamacpp**。
- `t1_turn_encoding.model` 写的是常量 `sparse-embed-v1`，不是物理模型 id。
  → 换 gguf / 换 engine 后，DB 里看不出差异，回填还会认为“已编码”而跳过。

这意味着：
1. 我们无法回答“这批原子是哪个模型、哪次校准产的”；
2. 参数集里的 `modelTag` 也就无法绑定到真实模型；
3. 一旦模型切换，旧原子与新原子会混在同一个 `sparse-embed-v1` 下。

## 5. 所以：先修溯源，再谈重标定

顺序应该是：

1. **stats 报真实 provider**：`providerId`（如 `llamacpp:Qwen3-…gguf`）+ `engine` + `dims`，
   不再读 `config.model` 字面量。
2. **encoding marker 写真实 providerId**（或 `providerId@dims`），替换常量 `sparse-embed-v1`。
3. **配置一致性校验**：`engine=llamacpp` 时若 `model` 是 ONNX 字符串，启动时警告/规范化；
   避免“配置看起来是 A，实际跑的是 B”。
4. **模型切换策略**：marker 不一致时，回填脚本要么重编码，要么在参数集里显式标注“混合来源”，
   不能静默混用。
5. **评估切片**至少包含：type、authority、boundary_source、语言、月份、providerId。

## 6. 一句话

- 应该谨慎：异质性不只在“记忆类型”，还在 **authority、边界来源、时间、模型/引擎**。
- 最危险的不是阈值，而是**溯源**：现在无法从 DB 判断原子由哪个模型产生；
  在这个问题修好之前，任何“通用参数”的结论都不可信。
