# G2 写相路由（laya 冗余门）设计

> 日期：2026-10-09（v2：挂点从 consolidation 改为 route-write，用户已批准）
> 前置：`2026-10-09-brain-research-refresh.md`（G2 缺口）、D3 laya 三值门（`2026-10-09-d3-laya-three-way-gate.md`）
> 脑依据：repetition suppression（冗余不再编码）+ DG/CA3 模式分离/完成（写入瞬间路由）+ 重复=Hebbian 强化旧痕迹

## 1. 目标与边界

**目标**：新记忆写入时，laya 本地判冗余——
- 减少冗余条目入库（存储卫生）
- 高置信时跳过 route-write 的 LLM judge（写相 judge 成本）

**明确不做**：
- 不动 worker 提取成本（turnCompress/index-scan；index-scan 占 87% 成本归 G4 检索仲裁）
- 不做硬删除（全系统 soft-supersede 不变量；S1 的 dup skip 仅限逐字重述，本门不触碰）
- 不动 consolidation 的 conflict 级联（tauHigh/tauLow 语义不变）——冗余门是写时路由的新分支，不是 consolidation 的改造

## 2. 挂点：route-write（S1 写时路由）

现有 `decideRouting`（`gateway/src/memory/route-write.ts`）：
```
cosine ≥ dupCosine(0.95) 且逐字相同 → skip（既有，不动）
0.8–0.95 中间带 → LLM judge
< candidateCosine(0.8) → create 快路径
```

冗余门插在中间带、LLM judge **之前**：
```
中间带候选 → laya askPair（一次调用双问题）
  max(pRedundant) ≥ tauRedundantHigh → 【新】redundant 出口（沉底+强化，跳过 LLM judge）
  否则 → LLM judge（既有；observe 期间 judge 结果即校准 ground truth）
```

挂这里的理由（vs consolidation 写后沉底）：写前判定直接省掉 route-write 的 LLM judge 调用（真省成本）；与 dupCosine 门同层并列，决策链一处可读；consolidation 的 conflict 语义不受污染。

## 3. 机制

### 3.1 laya 客户端双问题

`LayaConflictClient` 加：

```typescript
export const REDUNDANT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)是否已被已有记忆(known)覆盖？覆盖=known已包含new的实质内容，new不带来新事实',
  labels: { false: '未覆盖', true: '已覆盖' },
} as const;

askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null>
```

一次 `/v1/predict` 携带两个 question；任一字段缺失按该字段 null（redundant null → 冗余门不触发，fall through 到 judge，fail-open）。熔断器沿用。`askConflict` 保留（consolidation 现有调用不改动）。

### 3.2 route-write 改动

**`RouteWriteDeps` 新增**：
```typescript
laya?: {
  client: { askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null> };
  tauRedundantHigh: number;   // 1.0 = observe-only（默认）
  maxTextChars?: number;      // 默认 800
};
/** 读候选正文（laya 需要 memory_value，readEntry 只有 abstraction） */
readUnit?: (id: string) => Promise<{ memory_value?: string } | null>;
/** 审计：每次路由一行（校准数据源），fail-open */
onRoute?: (record: RouteAuditRecord) => void;
```

**`RoutingOutcome` 新增**：`{ action: 'redundant'; targetId: string }`

**`routeAndWrite` 处理 redundant（沉底+强化，用户批准的组合）**：
```typescript
const sunk: HarmonicUnit = {
  ...unit,
  energy: 0.05,
  cue_anchors: dedupeCap([...(unit.cue_anchors || []), `redundant:${decision.targetId}`], 8),
  updated_at: new Date().toISOString(),
};
await store.write(sunk, undefined, { skipMerge: true });
getRetrievalEventBuffer().record({ id: decision.targetId, prob: pRedundant, kind: 'recall', ts: Date.now() });
routeStats.redundant++;
```

- **沉底**（可挽回）：energy 0.05 + `redundant:<coveringId>` 锚——BM25 尾部可捞回，几天内自然衰减到不可见；不走 supersede 链（旧条目未被取代）
- **强化**（脑保真）：覆盖条目记一次合成检索事件，每日衰减 pass 按既有 `actrBonus` 结算（cap 0.02、重复折扣、clamp 1.0 全部继承）；`kind:'recall'`（record 会把非 'search' 归一为 'recall'；该命中同时计入 7 天 need 索引——冗余命中语义上就是重复曝光，正当）
- `skipMerge: true` 防 MinHash 把沉底条目合并掉

### 3.3 consolidation 防二次处理

沉底条目经 `store.write` 会触发 `onMemoryWritten` → consolidation。在 `consolidateInner` 入口加守卫：
```typescript
if (unit.cue_anchors?.some((a) => typeof a === 'string' && a.startsWith('redundant:'))) {
  return { action: 'skip', reason: 'redundant-sink' };
}
```

### 3.4 审计

```typescript
interface RouteAuditRecord {
  newId: string;
  newAbstraction: string;
  candidates: Array<{ id: string; cosine: number }>;
  redundantScores?: Array<{ id: string; p: number }>;  // laya redundant per candidate
  verdict: 'create' | 'update' | 'separate' | 'skip' | 'redundant';
  decidedBy: 'fast-path' | 'dup' | 'laya-redundant' | 'llm-route';
  ts: number;
}
```
index.ts 把 `onRoute` 落到**同一个** `~/.mafw/logs/consolidation-pairs.jsonl`（校准器读单文件；`decidedBy` 区分来源）。

### 3.5 校准（observe-first，对齐 laya 接入约束 `mem_1791526546074_oosl9o`）

- `config.memory.embedding.laya.tauRedundantHigh` **默认 1.0 = 永不触发（纯 observe）**
- `laya-calibrate.ts` 加 `proposeTauRedundantHigh(records)`：
  - ≥50 个带 redundantScores 的记录
  - ≥5 个 update-verdict 记录（无 update 无法验证安全性 → null）
  - **T = max(update  verdict 记录的 maxRedundant) + ε**：阈值以上不许有任何 update（冗余覆盖的条目不该是"需要更新"的；保守方向分离性检验）
  - T ≥ 0.99 → null（无安全线，与 tauHigh 失明带同理）
  - 有用性：T 以上 ≥3 条非 update 记录，否则 null（开闸无意义）
- `scripts/calibrate-laya.ts` 输出扩展为双提议（tauLow + tauRedundantHigh）
- 开闸需用户显式批准改 config，与 tauLow 同流程
- 既有 187 条旧记录无 redundantScores 字段——读取兼容（跳过无 redundant 分的行）

### 3.6 配置

```yaml
memory:
  embedding:
    laya:
      tauRedundantHigh: 1.0   # 默认 observe-only
```

index.ts：`setRouteWriteDeps` 增 `laya`（复用 consolidation 同一个 `LayaConflictClient` 单例）、`readUnit`（judgeStore.read）、`onRoute`（append jsonl）。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `gateway/src/memory/laya-client.ts` | `REDUNDANT_QUESTION` + `askPair` |
| `gateway/src/memory/route-write.ts` | laya 冗余门 + `redundant` 出口 + 沉底/强化 + `routeStats.redundant` + `onRoute` |
| `gateway/src/memory/consolidation-service.ts` | `redundant-sink` 守卫 |
| `gateway/src/memory/laya-calibrate.ts` | `RouteAuditRecord` 兼容读取 + `proposeTauRedundantHigh` |
| `gateway/scripts/calibrate-laya.ts` | 双提议输出 |
| `gateway/src/config.ts` | `tauRedundantHigh` schema + 默认 1.0 |
| `gateway/src/index.ts` | 接线（laya/readUnit/onRoute 进 setRouteWriteDeps） |
| 测试 | 见 §5 |

## 5. 测试计划（TDD）

1. `laya-client.test.ts`：`askPair` 请求体含双 question；redundant 字段缺失 → `pRedundant:null` 但整体非 null；整体失败 → null；熔断器沿用
2. `route-write` 冗余门：中间带 + pRedundant≥tau → `{action:'redundant', targetId}`（不发 judge）；pRedundant<tau → judge 照常；askPair null → judge 照常（fail-open）；无 laya dep → 现状逐字节一致
3. `routeAndWrite` 沉底：energy 0.05 + `redundant:<id>` 锚 + skipMerge 调用断言 + RetrievalEventBuffer 收到 targetId 事件（prob=pRedundant）+ `routeStats.redundant` 递增
4. `onRoute` 审计：各 decidedBy 分支记录字段完整；onRoute 抛错不影响路由（fail-open）
5. `consolidation-service`：`redundant:` 锚条目 → `{action:'skip', reason:'redundant-sink'}`
6. `laya-calibrate.test.ts`：`proposeTauRedundantHigh`——update 分布顶到 0.99 → null；记录数不足 → null；正常分离 → 提议 T=maxUpdate+ε；旧格式（无 redundantScores）跳过不炸
7. 回归：tauRedundantHigh=1.0（默认）下 decideRouting 行为与现状一致

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| redundant 契约 off-label 误判 | tauRedundantHigh=1.0 默认 observe-only；校准是保守方向（阈值以上不许有 update） |
| 沉底条目误判后找不回 | 不硬删，BM25 尾部可捞；`redundant:` 锚可枚举复查 |
| 强化 rich-get-richer | actrBonus 自带重复曝光折扣 + cap 0.02 + clamp 1.0 |
| 中间带每写一次多一次 laya 调用 | 本地模型 ~ms 级，写路径非热路径；laya down → null → fall through judge（零回归） |
| 审计文件混入两种记录 | `decidedBy` 区分；calibrate 对缺 redundantScores 的行跳过 |

## 7. 验收

- 全量 jest 绿（1826 + 新增）
- root build exit 0
- 默认配置下行为与现状一致（observe-only 零行为变化）
- 部署后 consolidation-pairs.jsonl 出现 `redundantScores` 字段
