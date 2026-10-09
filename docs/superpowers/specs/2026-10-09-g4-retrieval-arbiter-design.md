# G4 检索仲裁（MARTA 式元认知门）并入 L3 设计

> 日期：2026-10-09 ｜ 缺口来源：`2026-10-09-brain-research-refresh.md` §2 G4
> 外部依据：MARTA（arXiv:2610.05223）——先自评内部不确定性再决定是否检索，
> 省检索成本并防「检索依赖症」（注入的边缘相关记忆覆盖正确的参数知识答案）。
> 与 FOK 互补：FOK 判「记忆库里有没有」（检索后），G4 判「参数知识够不够」（检索前/后仲裁）。

## 1. 问题

MAFW 每轮 LLM 调用前无条件执行边界 recall（74ms BM25 + 注入）。两个代价：

1. **检索依赖**：FOK low-confidence 区注入的边缘相关指针可能把模型拉离其本来正确的
   参数知识答案（MARTA 的核心发现）
2. **无差别成本**：纯通用编程问题（"Python 怎么反转字符串"）与项目特定问题
   （"我们的 embedding sidecar 为什么 OOM"）走同一条重检索路径

已有相邻机制：FOK 三区门（R5/L3，检索后判有没有）、R8 快照包含度（话题漂移判定）。
缺的是**参数自评**这一极。

## 2. 设计

### 2.1 仲裁器（纯函数，零 LLM，<1ms）

`gateway/src/recall/parametric-arbiter.ts`：

```typescript
arbitrateRetrieval(query: string, ctx: {
  entityOverlap: number;   // 查询 token 命中已知 cue_anchor/项目实体的比例（R7 标识符索引）
  fokZone?: FokZone;       // 检索后已知时传入
  top1prob?: number;
}): { action: 'retrieve' | 'annotate-parametric' | 'annotate-sparse'; reason: string }
```

三态（**v1 从不硬跳过检索**——漏注入用户上下文的代价 ≫ 74ms）：

| action | 条件 | 效果 |
|---|---|---|
| `retrieve` | 默认（有实体重叠 / 第一人称时间指涉 / 任何不确定） | 现状不变 |
| `annotate-parametric` | 实体重叠 = 0 且查询形态为通用知识（无 my/我们/上次/这个repo 等自指标记）且 FOK=no-memory | 注入块头部加「参数知识可能足够；以下检索仅供参考」提示 |
| `annotate-sparse` | FOK=low-confidence 且实体重叠低 | 注入块加「相关性弱，优先信参数知识」提示 |

### 2.2 实体重叠计算（复用既有基建）

- 已知实体集 = harmonic index 全量 cue_anchors 的高 IDF 子集（IDFStats 过滤 hub）
  + R7 标识符索引；查询 tokenize（CJK unigram + 单词）后算包含度（overlap/min 侧，
  与快照话题判定同式——Jaccard 长度偏置前车之鉴）
- 自指标记正则：`我|我们|咱|上次|昨天|之前|这个?(?:项目|仓库|repo)|my\b|our\b|last\s+(?:time|week)`
  命中即 retrieve（无仲裁空间）

### 2.3 挂点与观测

- `/api/recall/context` 路由：BM25 出分后、FOK 判定后调用仲裁器；annotate 结果拼进
  inject 块头部（`inject-format.ts` 加 `ARBITER_PARAMETRIC_NOTE` / `ARBITER_SPARSE_NOTE`）
- **observe-first**：每次仲裁落一行进 `~/.mafw/logs/arbiter-samples.jsonl`
  （query 哈希、entityOverlap、fokZone、top1prob、action）——攒数据后可离线拟合
  「哪些查询形态检索从未产生点击」（RetrievalEventBuffer join），那时才考虑真跳过
- 配置：`search.arbiter: true`（默认 on——annotate-only 无破坏面）

### 2.4 与 index-scan 的关系

index-scan（$377/83% 成本）是 worker 驱动的生成型扫描，不在边界路径。G4 v1 不门控
index-scan（其触发由 turnCompress 编排，query 形态不同）；仲裁样本数据积累后，
可把「低实体重叠会话」的 index-scan 频率降档作为 P2 候选。

## 3. 测试计划

1. 仲裁器纯函数：三态矩阵（实体有/无 × FOK 三区 × 自指标记有/无）
2. 实体重叠：CJK/英文/标识符混合查询；hub 锚点不计入
3. inject-format：两条 note 的渲染与预算占用
4. 路由集成：annotate 不改变指针内容，只加头部行；observe 落 jsonl
5. fail-open：IDFStats 缺失 / 空索引 → retrieve

## 4. 边界

- v1 永不硬跳过（`skip` 动作保留为枚举但不可达——留待样本证据）
- 不改排序、不改 FOK 阈值、不接审批
- 不引入 LLM 自评（FOK 文档已证：LLM 自报置信度无用 arXiv:2605.24299）
