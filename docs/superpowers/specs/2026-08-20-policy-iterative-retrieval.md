# Policy 迭代检索（mafw_search_hybrid 多轮扩展）设计

日期：2026-08-20
状态：待审查

## 1. 目标

把 `mafw_search_hybrid` 从"单次检索"改造成"主 agent 驱动的多轮迭代检索"：首轮 bm25 检索后返回可扩展状态（state），主 agent 依据返回判断是否携带 state 继续扩展（锚点图邻居），直到记忆足够或达轮次上限。零额外 LLM 成本（复用主 agent 回合）、零缓存破坏、召回提升（多跳相关记忆进入结果）。

## 2. 背景（调研结论）

**Memora（微软，ICML 2026）** 的 policy 检索是 MDP 循环（refine/expand/stop），由独立策略 LLM 驱动，LongMemEval 87.4%（GPT-4.1-mini 决策 + gpt-4o-mini judge）。多跳类提升最大（temporal 89.5%、multi-session 78.2%）。

**方案演化**：
- 原方案：gateway 内部独立决策 LLM（mimo）驱动 refine/expand/stop——有额外 LLM 成本 + 缓存破坏 + 小模型决策不可靠（mimo 实测长上下文空输出）
- **最终方案（用户决策）**：循环"外翻"到 MCP 工具交互层，**主 agent 直接决策**——每轮是主 agent 正常思考回合，零额外 LLM 调用；refine 由主 agent 天然支持（改写查询再调用）；gateway 只做有状态检索（bm25 + 锚点图邻居 + 去重）

**适用范围**（用户确认）：
- ✅ `mafw_search_hybrid`：默认启用迭代（工具描述引导）
- ❌ recall 注入（`/api/recall/context` + step-ended）：保持 bm25 单次（主链路毫秒级）
- ❌ `/api/memory/search`：保持 bm25（桌面浏览用）

**基础设施**（已完成，本设计依赖）：
- `AnchorGraphStore`（SQLite anchor_units/anchor_edges，写路径增量 + 启动 rebuild）
- `HarmonicIndexManager.searchScored` 锚点图扩展（bm25×0.85 + graph×0.15 融合）
- config.search.graph（enabled/maxHops/maxNeighbors/damping/candidateCap/rerankGraphWeight）

## 3. 工具接口改造

### 3.1 输入/输出

```
输入: { query, topK?, retriever?, state? }
输出: {
  results: MemoryUnit[],      // 本轮增量结果（已过滤 state 中已见条目）
  canExpand: boolean,         // 锚点图前沿非空且轮次 < maxExpandRounds
  state: string | null,       // 不透明状态：seen + frontier + round（base64url(JSON)）
  round: number,              // 当前轮次（0 起）
  hint: string                // 迭代引导文案
}
```

### 3.2 state 编码

```json
{ "seen": ["id1","id2"], "frontier": ["idA","idB"], "round": 1 }
```
- JSON 压缩 → base64url（无签名，local 场景够用；解码失败回退首轮）

### 3.3 执行逻辑（search-hybrid.ts 内）

```
首轮（无 state）:
  results = bm25(query, topK)                     # 现有逻辑
  frontier = 锚点图邻居(results 的 id, 各 top 3) - seen(空)
  canExpand = frontier 非空 && round(0) < maxExpandRounds

迭代轮（有 state）:
  decoded = decode(state)（失败 → 按首轮处理）
  frontierHits = 取 decoded.frontier 中条目（过滤 superseded / 已见）
  bm25Hits = bm25(query, topK)（过滤已见）
  merged = 融合排序（bm25×0.85 + graph×0.15，复用 searchScored 融合）
  results = merged 中不在 seen 的新条目
  newFrontier = 新条目邻居 + 剩余旧 frontier - 全部 seen
  canExpand = newFrontier 非空 && round+1 < maxExpandRounds
  state = 编码(seen+新 results, newFrontier, round+1)
```

### 3.4 工具描述强化

```
搜索谐波记忆。若返回 results 不足以回答问题且 canExpand=true，
携带返回的 state 再次调用本工具继续扩展检索（共享锚点相关记忆）。
记忆已足够时停止。最多扩展 2 轮。
```

## 4. 配置

```ts
search: {
  ...,
  maxExpandRounds: 2,   // 迭代轮次上限（state round 上限，0 起）
  graph: { ... }        // 复用现有锚点图配置
}
```

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| state 解码失败 | 忽略 state，按首轮处理（bm25 全量） |
| 锚点图不可用 | canExpand=false，退化现有单次搜索 |
| superseded 条目在 frontier | 过滤 |
| 已见条目重复 | seen 去重 |
| 轮次超限 | canExpand=false + hint 提示已达上限 |

## 6. 验证

**单元测试**（`tests/unit/gateway/search-hybrid-policy.test.ts`）：
1. 首轮返回 results + canExpand + state（有共享锚点）
2. 迭代轮携带 state → 返回增量（不含已见）、frontier 推进
3. 无共享锚点 → canExpand=false（不污染现有行为）
4. 坏 state → 回退首轮
5. 轮次上限 → 第 3 轮 canExpand=false
6. 无 state 单次调用行为不变

**集成测试**（memory-quality.test.ts 扩展）：
- 带图 store：两共享锚点记忆 → 首轮 A → state 迭代后 B 出现

**LongMemEval**：
- L1 门禁：隔离无图 → 结果不变（R10=0.949 保持）
- policy 是 agentic 迭代，benchmark 单次检索无法直接测；验证单次调用（无 state）输出与现状一致

## 7. 里程碑

1. M1: search-hybrid.ts 改造（state 编解码 + 迭代逻辑）+ 单测
2. M2: 工具描述更新 + config.maxExpandRounds
3. M3: 集成测试 + LongMemEval 门禁确认 + 部署（build + 全局包同步）
