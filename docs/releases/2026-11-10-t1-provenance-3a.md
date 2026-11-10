# 2026-11-10 · T1 Exact Provenance Phase 3A（未部署）

- **分支**：`feat/t1-retrieval-2a`（延续 2A/2B，未合并/未部署）
- **计划**：`docs/superpowers/plans/2026-11-10-t1-provenance-3a.md`
- **设计**：`docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.3 / §6.1
- **本阶段提交**：`c6f99490`（持久化）→ `56a76c76`（写入校验）→ `8095feec`（transcript 标记）→ `03c774f3`（读取与覆盖率）
- **状态**：已实现并通过全量门禁；**尚未部署**

## 交付内容

### 1. 单元级精确来源

- `HarmonicUnit.source_trace_ids?: string[]`、`HarmonicIndexEntry.source_trace_ids?: string[]`。
- OKF frontmatter 持久化；旧文件无该字段时解析行为不变。
- merge/update（write-time routing + consolidation）对 incoming 与 target 的 trace 取并集，去重、上限 20，incoming 优先。

### 2. 写入捕获与校验

- 抽取 transcript 每行前缀 `[trace:<traceId>]`（无 trace 的 legacy 行保持旧格式）。
- `TOOL_EXTRACTION_SYSTEM` 要求 curator 为每条记忆传入支持它的 `sourceTraceIds`（最多 20，禁止猜 id）。
- `mafw_add_memory` 新增 `sourceTraceIds` 参数；`normalizeSourceTraceIds` 依次执行：字符串过滤、去 `t1:`/`#t1:` 前缀、去重、`t1_turns` 存在性校验、上限 20。未知 id 丢弃，记忆照常写入（worker 不配合也不失败）。
- MCP 与 HTTP `/api/memory/add` 同一规则；`GatewayDatabase.hasTrace()` 提供廉价存在性检查。

### 3. 读取与覆盖率

- `mafw_get_memory` 优先解析 `source_trace_ids`（最多 5 条）：

```json
{
  "source": {
    "sessionId": "ses_...",
    "traces": [
      { "traceId": "t1t_...", "sessionId": "ses_...", "turnId": 3, "archived": true, "excerpt": "…" }
    ]
  }
}
```

- 解析不到时回退旧 C0 `source.evidence`（`source_session_id` + archive 搜索）。
- `/api/memory/stats` 的 `t1` 新增：

```json
{
  "provenance": { "memories": 0, "withExact": 0, "coverage": 0 }
}
```

### 4. 明确非目标

本阶段**不改变** energy、排序、activation、recall 注入或快照内容。`source_trace_ids` 只是可审计的精确边，供下一阶段有界传播使用。

## 门禁结果

- gateway 全量：`npx jest --runInBand --forceExit` → **743 suites / 5796 tests，0 fail**
- SDK：`cd packages/gateway-sdk && npm test` → **205 tests，0 fail**
- 类型：`cd gateway; npx tsc --noEmit -p tsconfig.json` → **rc=0**
- 根构建：`npm run build` → **rc=0**
- 3A 新增测试：**19**（持久化/合并 6、写入校验 7、transcript 3、读取 2、覆盖率 1；gateway 5777 → 5796）

## 已知限制

- 覆盖率取决于 curator 是否遵循 `sourceTraceIds` 指令；未遵循时记忆无精确来源，但写入不失败。部署后需观察 `t1.provenance.coverage`。
- 旧单元没有 `source_trace_ids`，只有回填/重新抽取后才会获得；本阶段不做事后推断回填。
- `mafw_get_memory` 只展开前 5 条 trace 摘要；完整原文仍需 `mafw_get_memory("t1:<traceId>")`。
- 暂未建立独立的 `T1Provenance(memory_id, trace_id, relation, weight)` 关系表；v1 以 OKF frontmatter + index entry 为真相源。
- 未实现 activation/排序/驻留消费；那是 3B。
- 未部署。
