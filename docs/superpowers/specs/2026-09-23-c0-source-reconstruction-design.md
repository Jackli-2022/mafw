# C0 · 检索回源重建（Source Reconstruction）设计

> 日期：2026-09-23 · 状态：设计已确认，待写实施计划
> 范围：C0——`mafw_get_memory` 兑现指针时，从 `t1_archive` 回源重建原始回合证据
> 前置：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（§1.3C 海马索引 / §4 三方对照）

## 1. 背景与目标

**关键事实（实测）**：MAFW 的"海马体类似物"已经存在但**只写不读**——`t1_archive` 有 **41523 原始回合 / 448 会话**（turnCompress 归档），检索从不查询。检索只从 gist 库（`primary_abstraction`，p50 45 字符）查，所以"稀疏索引 → 重建"缺后半段。

**目标**：`mafw_get_memory` 在兑现指针（`<recall>` 的 `#mem-xxxxxx`）时，从其 `source_session_id` 回源 `t1_archive`，返回**原始回合证据**，补上"指针 → 重建"。

**非目标**：不建持久 turn 索引（C0b，若 LIKE 质量不足再做 FTS5）；不改 boundary recall / `<recall>` 块（守 100ms）；不动存储。

> **覆盖上限（重要）**：`source_session_id` 的**来源决定回源是否命中**。只有**插件原生 `mafw_add_memory`**（用户会话，`index.ts:6045` 存 `ctx.sessionID`）的记忆能在 `t1_archive` 找到来源回合；**turnCompress/reflection 管线**写的记忆其 `source_session_id` 是 **worker 会话**（`memory-worker.ts:53`），worker 会话不落 `t1_archive`（内部会话被排除）→ 对这些记忆回源为 no-op。修正 provenance 不在 C0 范围。

## 2. 现状（代码事实）

- `t1_archive(session_id, turn_id, source, content, failure, created_at)`；索引 `idx_t1_archive_session(session_id, turn_id)`（`gateway-db.ts:175-185`）。
- 已有 `listArchiveTurns(session_id)`（`gateway-db.ts:363`）、`readArchiveTurn(session_id, turn_id)`（`:356`）——**无按锚点搜索**。
- `HarmonicIndexEntry.source_session_id`（`harmonic-types.ts:46`）链回来源会话。
- `handleGetMemory`（`mcp/handlers/get-memory.ts:11`）返回 `{ memory, latest? }`——**不含原始证据**。
- `Services`（`types.ts:23`）无 archive 访问；MCP 走 `createToolRegistry()` + `services`（`index.ts:2086/2103`）；HTTP 路由显式传 `{ memory, mafwDir }`（`index.ts:3376`）。

## 3. 设计

### 3.1 回源搜索（`GatewayDatabase.searchArchive`）
新增（`gateway-db.ts`）：
```ts
/** Search a session's archived turns by anchor substrings (LIKE), best-match first. */
searchArchive(session_id: string, anchors: string[], k: number): T1Observation[] {
  if (!session_id || anchors.length === 0 || k <= 0) return [];
  const likes = anchors.map(() => 'content LIKE ?').join(' OR ');
  const rows = this.db
    .prepare(`SELECT * FROM t1_archive WHERE session_id = ? AND (${likes}) ORDER BY turn_id LIMIT 200`)
    .all(session_id, ...anchors.map(a => `%${a}%`)) as T1Observation[];
  const scored = rows
    .map(r => ({ r, hits: anchors.filter(a => r.content.includes(a)).length }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.r.turn_id - b.r.turn_id);
  return scored.slice(0, k).map(x => x.r);
}
```
（`idx_t1_archive_session` 命中 session_id；`LIMIT 200` 防大会话；`hits` 计锚点命中数排序。）

### 3.2 渲染（纯函数，可测）
新增 `gateway/src/recall/source-reconstruction.ts`：
```ts
import { T1Observation } from '../memory/gateway-db';

/** Render archived turns as budgeted evidence lines (empty when nothing fits). */
export function reconstructSource(turns: T1Observation[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of turns) {
    const tag = t.source === 'user_input' ? 'USER'
      : t.source === 'reasoning' ? 'THINKING'
      : t.source === 'tool_result' ? 'TOOL' : 'ASSISTANT';
    const line = `[${tag}] ${(t.content || '').replace(/\s+/g, ' ').trim()}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
```

### 3.3 兑现（`handleGetMemory`）
`handleGetMemory` 解构加 `searchArchive`；在返回体加 `source`（仅当有 `searchArchive`、目标有 `source_session_id`、且开关开）：
```ts
let source: { sessionId: string; evidence: string } | undefined;
if (searchArchive && unit.source_session_id && config.recall.sourceEvidence.enabled) {
  try {
    const turns = searchArchive(unit.source_session_id, unit.cue_anchors ?? [], config.recall.sourceEvidence.k);
    const evidence = reconstructSource(turns, config.recall.sourceEvidence.maxChars);
    if (evidence) source = { sessionId: unit.source_session_id, evidence };
  } catch { /* fail-open */ }
}
// ...return { success:true, memory: unit, ...(latest?{latest}:{}), ...(source?{source}:{}) }
```

### 3.4 配置
`config.recall` 新增（`config.ts:168` 接口 + `:384` 默认）：
```yaml
sourceEvidence:
  enabled: true
  k: 5
  maxChars: 1500
```

### 3.5 接线
- `Services`（`types.ts`）新增：`searchArchive?: (sessionID: string, anchors: string[], k: number) => T1Observation[];`
- `index.ts` 的 `services`（`:2086`）注入：`searchArchive: (sid, anchors, k) => this.getGatewayDb().searchArchive(sid, anchors, k),`
- `index.ts` 的 HTTP 路由（`:3376`）也传 `searchArchive`。

## 4. 测试

- **DB 单测** `source-reconstruction-db.test.ts`：`searchArchive` 按锚点命中排序、跨会话不串、k 截断、空参数返回空。
- **纯单测** `source-reconstruction.test.ts`：`reconstructSource` 角色标签、预算截断、空输入空串。
- **handler 集成** `get-memory-source.test.ts`：注入 fake `searchArchive`，断言返回体含 `source.evidence` 与原始 turn；无 `searchArchive` 时不附。
- **回归**：现有 `get-memory.test.ts` + 全量套件。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| LIKE 召回不准（字面匹配） | 锚点通常 3–8 个；质量不足再上 FTS5（C0b） |
| 大会话 LIKE 慢 | `LIMIT 200` + `idx_t1_archive_session` |
| 证据过大 | `maxChars` 预算 + `k` 上限 |
| 改 handler 影响现有路径 | `searchArchive` 缺失时行为不变（可选注入） |

## 6. 涉及文件

- 修改：`gateway/src/memory/gateway-db.ts`（`searchArchive`）
- 新增：`gateway/src/recall/source-reconstruction.ts`（`reconstructSource`）
- 修改：`gateway/src/mcp/handlers/get-memory.ts`（兑现 `source`）
- 修改：`gateway/src/types.ts`（`Services.searchArchive`）
- 修改：`gateway/src/config.ts`（`recall.sourceEvidence`）
- 修改：`gateway/src/index.ts`（services + HTTP 路由注入）
- 测试：`gateway/tests/unit/source-reconstruction-db.test.ts`、`source-reconstruction.test.ts`、`get-memory-source.test.ts`
