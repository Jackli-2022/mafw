# 2026-11-10 · T1 Retrieval Phase 2A（未部署）

- **分支**：`feat/t1-retrieval-2a`（base `82b5df09`，含 T1 identity merge `d4779d63`）
- **计划**：`docs/superpowers/plans/2026-11-10-t1-retrieval-2a.md`
- **设计**：`docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md`
- **本阶段提交**：`e2a57a0e`（计划）+ `691dac89` / `ad30e249` / `3f945e68` / `ef5ece00` / `81fc2647` / `cf11909e`
- **状态**：已实现、通过全量门禁；**尚未部署**

## 交付内容

### 1. T1 命中带永久身份

`T1Hit` 现在携带 `traceId`；指针优先渲染 `[t1|<traceId>]`，旧数据或无 trace 时回退 `[t1|<sessionTail>:<turnId>]`。

### 2. Agent 主动分层搜索

`mafw_search_hybrid` 新增：

```text
layer=gist   # 默认；只搜 Harmonic，结果形状与旧行为一致
layer=t1     # 只搜 T1 verbatim
layer=both   # 两路都搜，分区返回
```

T1 结果字段：`traceId/sessionId/turnId/cosine/excerpt`。默认 gist 不触发 T1 搜索、不产生 `t1Results`。

### 3. HTTP 分层搜索

`GET /api/memory/search?layer=gist|t1|both`：

- 默认响应仍为 `{ results }`
- `t1`：`{ results: [], t1Results }`，不要求 Harmonic memory service
- `both`：`{ results, t1Results }`

### 4. T1-only 自动召回

`buildSnapshot` 不再在 Harmonic 零命中时提前返回：

- Harmonic 命中 → 原验证/渲染逻辑
- Harmonic 零命中但 T1 命中 → 生成 T1-only 快照，带
  `[T1 原始记录 · 依据前请核实：取全文 → mafw_get_memory("t1:<traceId>")]` 头和 trace 指针
- 两路都空 → 才返回空

`decideSnapshotUse` 接受 `ids=[]` 但 `t1Hits` 非空的快照。边界路径仍只读快照，100ms 契约不变。

### 5. 永久 trace 指针

`mafw_get_memory` 支持：

```text
t1:<traceId>                 # 新格式：active+archive，精确身份
t1:<sessionTail>:<turnId>    # 旧格式：保留兼容，archive 优先再查 active
```

新格式返回 `traceId/sessionId/turnId/archived/legacyAmbiguous/rows`；两者都会记录 `redeem` 事件（有 trace 时）。

### 6. 观测

新增 `t1_retrieval_events` 表（observe-only）：

- `search`：主动搜索命中
- `recall`：快照注入
- `redeem`：指针兑换
- 不参与 energy、排序或任何强化

`GET /api/memory/stats` 新增：

```json
{
  "t1": {
    "vectors": 0,
    "activeRows": 0,
    "archiveRows": 0,
    "coverage": 0,
    "retrieval": { "total": 0, "byKind": {}, "uniqueTraces": 0, "lastAt": null }
  }
}
```

## 门禁结果

- gateway 全量：`npx jest --runInBand --forceExit` → **737 suites / 5745 tests，0 fail**
- SDK：`cd packages/gateway-sdk && npm test` → **205 tests，0 fail**
- 类型：`cd gateway; npx tsc --noEmit -p tsconfig.json` → **rc=0**
- 根构建：`npm run build` → **rc=0**
- 本阶段新增测试：**32**（2A 主体 26 + 收尾 6：事件 prune 3、SDK 分层 3；T1 identity 原有测试未计）

## Minor 修复（2026-11-10 收尾）

- `t1_retrieval_events` 增加保留期：`pruneT1RetrievalEvents({ before })`，由每日 `memory:decay` 调用，保留天数取 `config.recall.t1Recall.retentionDays`（默认 90，0/负数关闭）；删除数量记入 heartbeat `prunedT1`。观测数据始终不参与 energy/排序。
- SDK 补分层 DTO：`MemoryLayer`、`T1SearchHit`、`MemoryLayeredSearchResult`、`T1RetrievalStats`，`MemoryStats.t1`；新增 `MafwClient.memory.searchLayered()`，`memory.search()` 保持旧行为且不发 `layer`。

## 已知限制

- T1 仍只有 dense 检索；标识符/路径/错误码的精确词面通道留到 Phase 2B。
- T1 向量覆盖仍不完整；自动回填与二进制索引留到 Phase 2B。
- 旧 T1 指针在 `legacy_ambiguous` 复合键上仍可能命中多段历史；新 trace 指针是精确入口，但 legacy ambiguous 只能显式提示，不能恢复真实边界。
- `search` / `recall` / `redeem` 事件只观测，不改变 T1 activation 或 Harmonic energy。
- `mafw_get_memory` 的 HTTP/SDK 类型尚未补充 trace pointer 的专用 DTO；当前仍以通用 JSON 返回。
- 未部署；部署需在最终 review 后单独执行。

> 后续：Phase 2B（`docs/releases/2026-11-10-t1-retrieval-2b.md`）已补齐 FTS5 词面通道、自动向量回填与 SQLite 二进制向量存储。

## 未实现（后续阶段）

- T1 activation / ACT-R 强化与 abstract→T1 传播
- 精确 `sourceTraceIds` provenance
- 原文重放/再巩固
- T1 词面索引、向量二进制化、自动回填
- Skill v1 能力契约与 deopt
