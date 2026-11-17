# 2026-11-17 · Retrieval Path Parity

- **分支**：`main`
- **调研**：`docs/research/2026-11-17-brain-retrieval-control-and-next-step.md`
- **计划**：`docs/superpowers/plans/2026-11-17-retrieval-path-parity.md`
- **代码提交**：`e3ad5b53f` → `2384cf021` → `13d95bd7b` → `b1cfca5ee` → `2af7cd3d2`

## 交付

本切片只收敛确定性分歧，不改变候选准入、recency、FOK 策略或 note-board。

1. **默认检索器**
   - `HarmonicIndexManager.searchScored` 使用已计算的 `options.retriever ?? 'bm25'`，省略 retriever 不再静默落到 token。

2. **MCP 分数保真**
   - `mafw_search_hybrid` 优先读取 `harmonicIndex.searchScored`，首轮、满轮与迭代轮的 fresh hits 保留真实分数。
   - 图扩展仍使用独立 graph score，不再把候选分数统一替换为 `1`。

3. **REST 共享索引**
   - `/api/memory/search` 使用 `memoryService.harmonicIndex`，不再每请求新建无图状态的 index。
   - 缺省 retriever 使用 `config.search.defaultRetriever`；显式 `token` / `bm25` / `guided` / `hybrid` 保持可用。

4. **Snapshot reranker 输入对齐**
   - `RecallMemory` 携带 `cue_anchors`；kernel 的 rerank/FOK 路径使用 `rerankerEntryFromRecall()`，与 MCP 输入形状一致。

5. **Scan 快照来源校验**
   - prefetch 生成的 `ScanResult` 记录 `query/builtAt`。
   - 自动 recall 合并 scan 前使用 `snapshotContainment` 做 topic-shift 检查；旧的无 query 快照保持兼容。

## 测试

新增 **7 个测试**：

- omitted retriever → BM25
- MCP 保留真实分数顺序
- REST 使用共享 index + 配置默认 retriever
- snapshot reranker 保留 cue anchors
- recall 结果携带 cue anchors
- scan prefetch 保存 query provenance
- 异主题 scan snapshot 不注入

验证结果：

- 定向（11 suites）：**341/341 passed**
- Gateway 全量：**1031 suites / 8203 tests；8201 passed，2 skipped，0 failed**
- 类型门禁：`npx tsc --noEmit -p tsconfig.json` 通过
- Build：通过；热重启 `pid 57204 → 12360`，health `ok`

## 线上抽查

- 自动 recall 仍正确显示主题头；`no-memory` 时只保留主题头 + note-board，不重新注入旧 recall 本体。
- 精确查询 `Proactive Topic Recall 主题工具设计` 仍未被自动注入：
  - 早期同名记忆已沿 `superseded_by` 链失效；
  - 当前 active 链头与上一轮线上评估在 REST top-50 中约排 33–35；
  - MCP reranker 的 top-5 被 desktop/Lead 等旧条目占据，`FOK=no-memory`。

因此本切片**只证明路径与分数语义已修正，不宣称检索质量已达标**。下一步仍是固定真实查询集与候选/采纳门控。

## 范围外

- 未改 recency 主排序、top-k、FOK 阈值或邻居策略。
- 未重新门控 note-board。
- 未新增 LLM、记忆生产管线或后台 topic 推理。
