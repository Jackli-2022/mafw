# 记忆系统与 Goal 全解绑 — 设计规格

## 目标

从 MAFW 记忆系统中彻底移除 `goal_id` 字段，使记忆完全独立于 goal 上下文。记忆存储、检索、蒸馏不再依赖 goal。

## 架构变化

```
之前: HarmonicUnit.goal_id → 存储 memory/tier3/{goalId}.json → 检索 filter by goalId
之后: HarmonicUnit (无 goal_id) → 存储 memory/tier3.json → 检索纯内容 BM25
```

## Section 1：数据模型 + 索引层

- `HarmonicUnit` 接口：删除 `goal_id: string | null`
- `HarmonicIndexEntry` 接口：删除 `goal_id: string | null`
- `HarmonicIndexManager.addEntry()`：不再存储 goal_id
- `HarmonicIndexManager.search()`：不变（已不按 goal 过滤）

涉及文件：`src/memory/harmonic-types.ts`、`src/memory/harmonic-index.ts`

## Section 2：存储层 — Tier 文件扁平化

- 存储路径从 `memory/{tier}/{goalId}.json` 改为 `memory/{tier}.json`
- `HybridCompressor.persistUnit()`：不再用 goalId 构造文件路径
- `AbstractionDistiller.loadTierUnits()` / `saveTierUnits()`：删除 goalId 参数，读写单文件
- `AbstractionDistiller` 的 T2→T3 分组逻辑不再按 goalId 分组
- `mafw_add_memory` handler：写入单文件

涉及文件：`src/compression/hybrid-compressor.ts`、`src/memory/abstraction-distiller.ts`、`src/mcp/tools.ts`

## Section 3：API 层 — MCP 工具参数精简

- `mafw_search_hybrid`：删除 `goalId` 参数和 post-filter 代码
- `mafw_add_memory`：删除 `scope`、`goalId` 参数

涉及文件：`src/mcp/tools.ts`

## Section 4：注入层 — plugin.ts 去 goal 化

- `executeHybridSearch()`：删除 goalId 参数、goal charter 读取、state 读取、review 前缀过滤、charter 合成结果
- `experimental.chat.messages.transform`：仍解析 goalId 用于判断是否处于 MAFW 工作流，但不再用于记忆检索
- 保留 parametric store 的搜索（关键字匹配改为纯文本匹配）

涉及文件：`src/plugin.ts`

## 不改的部分

- 成本系统（`CostRecord.goalId`）
- 状态系统（`src/utils/state.ts`）
- 引擎层（`src/engine/`）
- 问题/反馈系统（`run-ask-user.ts`、`run-record-feedback.ts`）
- 认知图谱（已无 goal 耦合）
- 复习调度器（已无 goal 耦合）
- MinHash 合并器（已无 goal 耦合）

## 现有数据处理

旧格式 `memory/tier3/{goalId}.json` 文件不处理，新代码只读写 `memory/tier3.json` 等单文件。
