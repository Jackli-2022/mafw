# G2 写相路由（laya 冗余门）设计

> 日期：2026-10-09
> 前置：`2026-10-09-brain-research-refresh.md`（G2 缺口）、D3 laya 三值门（`2026-10-09-d3-laya-three-way-gate.md`）
> 脑依据：repetition suppression（冗余不再编码）+ DG/CA3 模式分离/完成（写入瞬间路由）+ 重复=Hebbian 强化旧痕迹

## 1. 目标与边界

**目标**：新记忆写入时，laya 本地判定 `non-write / write-new / write-update` 三态——
- 减少冗余条目入库（存储卫生）
- 高置信时替代 consolidation 的 LLM judge（判官成本）

**明确不做**：
- 不动 worker 提取成本（turnCompress/index-scan 是另一层；index-scan 占 87% 成本的问题归 G4 检索仲裁，不在本 spec）
- 不做硬删除（全系统 soft-supersede 不变量）
- 不动 tauHigh/tauLow 既有语义

## 2. 机制

### 2.1 双问题同调用

`/v1/predict` 的 `questions` 字段原生支持多问题。`LayaConflictClient` 泛化：

```typescript
export const REDUNDANT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)是否已被已有记忆(known)覆盖？覆盖=known已包含new的实质内容，new不带来新事实',
  labels: { false: '未覆盖', true: '已覆盖' },
} as const;

// 新接口（askConflict 保留兼容或重构为包装）
askPair(known: string, newInfo: string): Promise<{ pConflict: number; pRedundant: number } | null>
```

一次 HTTP 调用返回两个概率；任一解析失败按该字段 null 处理（conflict null → 级联维持现状 escalate；redundant null → 冗余分支不触发）。熔断器逻辑不变。

### 2.2 级联决策矩阵（consolidation-service.layaCascade）

对每个 live 候选取双分后聚合（max 语义）：

```
1. max(pConflict) ≥ tauHigh           → UPDATE（既有行为，不变）
2. max(pRedundant) ≥ tauRedundantHigh → **NON-WRITE（沉底+强化）**
3. max(pConflict) ≤ tauLow 且 max(pRedundant) ≤ tauLow → CREATE（既有 laya-low）
4. 其余                                → LLM judge（escalate）
```

顺序即优先级：冲突更新 > 冗余沉底 > 直连新增。冲突优先是因为"内容矛盾"比"内容重复"更需要处置。

### 2.3 NON-WRITE 的两半（用户已批准的组合方案）

**沉底管安全**（可挽回）：
- 新条目**正常写库**（consolidation 本就是写后监听器，无需拦截写路径）
- 判冗余后：energy 置 0.05（同 rejected tentative 档位）+ cue_anchor 追加 `redundant:<coveringId>`
- 效果：BM25 尾部仍可捞回（误判可挽回），几天内自然衰减到检索不可见（卫生不衰）
- 不走 supersede 链——旧条目没有被取代，是新条目没必要存在

**强化管脑保真**（重复加强旧痕迹）：
- 给覆盖条目记一次合成检索事件：`getRetrievalEventBuffer().record({ id: coveringId, prob: pRedundant, kind, ts })`
- 每日衰减 pass 按既有 `actrBonus` 数学结算（cap 0.02、重复曝光折扣、clamp 1.0 全部自动继承）
- 零新增能量机制；event kind 枚举实现时确认（必要则加 `'redundant'` 类）

### 2.4 审计与观测

- `layaScores` 元素扩展为 `{ id, pConflict, pRedundant }`（读取方 calibrate 向后兼容：旧记录 `p` → `pConflict`）
- 冗余采纳时审计行 `decidedBy: 'laya-redundant'`，verdict 记 `'skip'`
- stats 加 `layaSkipped`（`/api/memory/stats` 透出）
- PipelineHeartbeat：冗余判定是本地零成本，**不受** PipelineBudget 门控（与 D3 laya 一致）

### 2.5 校准（observe-first，对齐 laya 接入约束 `mem_1791526546074_oosl9o`）

- `config.memory.embedding.laya.tauRedundantHigh` **默认 1.0 = 永不触发（纯 observe）**
- 积累方式：observe 期间所有对仍走 escalate → LLM judge，pairs jsonl 同时落双分数 + judge verdict
- **校准判据**（`laya-calibrate.ts` 加 `proposeTauRedundantHigh`）：
  - ≥50 个带 redundant 分数的对
  - 安全性：**阈值 T 以上不允许存在任何 judge verdict=update 的对**（冗余覆盖的条目不可能是"需要更新旧记忆"的；这是保守方向的分离性检验）
  - 有用性：T 以上 ≥3 对（否则开闸无意义）
  - 上限 0.99（与 tauHigh 一致，失明带永不自动行动）
  - 不满足 → `proposal: null`（与 tauLow 校准器同形态）
- 开闸需用户显式批准（改 config），与 tauLow 同流程
- `gateway/scripts/calibrate-laya.ts` 输出扩展为双提议（tauLow + tauRedundantHigh）

### 2.6 配置

```yaml
memory:
  embedding:
    laya:
      tauRedundantHigh: 1.0   # 默认 observe-only
```

## 3. 改动文件

| 文件 | 改动 |
|---|---|
| `gateway/src/memory/laya-client.ts` | `REDUNDANT_QUESTION` + `askPair` 双问题调用 |
| `gateway/src/memory/consolidation-service.ts` | 决策矩阵第 2 支 + 沉底 + 强化事件 + 审计/统计扩展 |
| `gateway/src/memory/laya-calibrate.ts` | `proposeTauRedundantHigh` + 双分数字段兼容读取 |
| `gateway/scripts/calibrate-laya.ts` | 输出双提议 |
| `gateway/src/config.ts` | `tauRedundantHigh` 默认 1.0 |
| `gateway/src/index.ts` | 接线 `tauRedundantHigh` 进 layaDeps |
| 测试 | 新增见 §4 |

## 4. 测试计划（TDD）

1. `laya-client.test.ts`：`askPair` 双问题契约（请求体含两个 question）、部分字段缺失 → 该字段 null、熔断器沿用
2. `consolidation-service` 决策矩阵四象限：conflict高→update / redundant高→skip+沉底字段断言+强化事件断言 / 双低→laya-low create / 中间带→llm
3. 优先级：conflict 与 redundant 双高 → update 赢
4. 沉底：energy 0.05 + `redundant:<id>` 锚 + `decidedBy:'laya-redundant'` 审计行 + `stats.layaSkipped`
5. 强化：RetrievalEventBuffer 收到 coveringId 事件（prob=pRedundant）
6. `laya-calibrate.test.ts`：旧格式 `{id,p}` 兼容；`proposeTauRedundantHigh`——T 以上有 update verdict → null；对数不足 → null；满足 → 提议值
7. tauRedundantHigh=1.0 默认下行为与现状逐字节一致（回归）

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| redundant 契约 off-label 误判 | tauRedundantHigh=1.0 默认 observe-only；校准判据是保守方向（只验"不误伤 update"） |
| 沉底条目误判后找不回 | 不硬删，BM25 尾部可捞；`redundant:` 锚可枚举全部沉底条目人工复查 |
| 强化造成 rich-get-richer | actrBonus 自带重复曝光折扣 + cap 0.02 + clamp 1.0 |
| 双问题使单次调用变慢 | 本地模型，pairs 串行调用本就非热路径（写后监听器，fire-and-forget） |

## 6. 验收

- 全量 jest 绿（1826 + 新增）
- root build exit 0
- 默认配置下行为与现状一致（observe-only 零行为变化）
- 部署后 pairs jsonl 出现双分数字段
