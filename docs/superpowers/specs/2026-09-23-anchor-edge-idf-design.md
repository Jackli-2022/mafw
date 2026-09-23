# P-A · 锚点边 IDF 加权（Anchor Edge IDF Weighting）设计

> 日期：2026-09-23 · 状态：设计已确认，待实施
> 范围：修 `AnchorGraphStore` 边权——按锚点度数现算 IDF，hub 边降增益（不删 hub）
> 依据：`docs/research/2026-09-23-brain-hub-control-survey.md`（待补）——大脑"保留 hub + 降增益 + 除法归一化"

## 1. 背景与实测

`anchor_edges` **213593 行 / 3211 单元（~66 边/单元）**，其中 **96%（204326）只共享 1 个锚点**，被 hub 锚点主导：`MAFW`(401 单元 → ~80k 边)、`desktop`(266)、`gateway`(252)、`mafw`(204) 合计 ~167k（78%）。

**根因**：`index.ts:2169` `new AnchorGraphStore(this.getGatewayDb())` **未传 IDFStats** → `this.idf` 为 null → `isNoisy` 过滤从不生效，且 `weight = sharedAnchors.size`（恒为 1）→ `getNeighbors` 按 `weight DESC` 时 hub 边与稀有边同权（顺序任意）→ hub 噪声挤掉有意义边。内存类 `AnchorGraph.buildImplicitEdges`（有 `hubThreshold=20`）**生产中无人调用**（死代码）。

**神经学依据**（调研）：大脑**不删 hub，只调增益**——神经适应/高效编码（Fairhall 2001）、突触短时压抑（Rothman 2009）、cue-overload（Watkins 1975）、**ACT-R `S − ln(fan)`**（Anderson & Reder 1999）、除法归一化（Carandini & Heeger 2011）。跳过 hub 无对应且丢失合法 connector。

## 2. 目标 / 非目标

**目标**：`upsertUnit` 按锚点在 `anchor_units` 中的**度数现算 IDF** 作为边权 → hub 边降增益、稀有边升权 → `getNeighbors` 排序正确。

**非目标**：不删 hub 边（保留，符合"保留+降增益"）；不改存储结构；不改 `getNeighbors` 的 `maxNeighbors` cap；不做读取归一化（后续可选）；不接 `IDFStats`（现算规避其未登录词返回 0 的坑）。

## 3. 设计

`AnchorGraphStore.upsertUnit`（`graph/anchor-graph-store.ts:33`）改：

1. 计算 `N = COUNT(DISTINCT unit_id FROM anchor_units)`（当前单元已插入）。
2. 对每个 anchor 计算**平滑 IDF** `idf(anchor) = Math.log(1 + N / max(1, df))`（`df` = 含该锚点的单元数）。
   - 稀有锚点（df=1）→ `log(1+N)`（最大）；hub（df=401, N=3396）→ `log(9.47)≈2.25`；小语料/全共享（df=N）→ `log(2)≈0.69`（**恒正，不归零**——非平滑 `log(N/df)` 在 df=N 时为 0，会误杀小语料/新锚点）。
3. 边权 `weight = Σ_{anchor∈shared} idf(anchor)`（替换现有 `idf ? ... : sharedAnchors.size`）。
4. 保留 `this.idf?.isNoisy` 检查（若将来接了 IDFStats 仍生效）；**移除**对 `this.idf` 为 null 时的 `sharedAnchors.size` 回退（改为始终现算 IDF）。

> 现算 IDF 而非接 `IDFStats`：`IDFStats.idf` 对未登录词返回 0（新锚点会被 `isNoisy` 误杀），且需随语料更新；现算恒为当前、无未登录问题。

## 4. 效果

- `MAFW`(df=401) 边权 ≈2.14；稀有锚点(df=1) ≈8.13 → **hub 边降权 ~4×**，`getNeighbors` 按权重降序时 hub 边不再挤掉稀有边。
- `anchor_edges` 213593 行**保留**（SQLite ~10MB，非瓶颈；`getNeighbors` 已有查询 cap）。
- 启动 `rebuild`（`index.ts:2171`）自动按新规则重建 → 重启即生效。

## 5. 测试

- **单测**（新增 `gateway/tests/unit/anchor-graph-store.test.ts`）：
  - 稀有锚点边权 > hub 锚点边权（60 单元共享 `hub`；2 单元共享 `rare`）。
  - `getNeighbors` 对 hub 单元的邻居排序仍按权重降序。
  - 新锚点（df=1）边权 = `log(N)`（未被误杀）。
  - `removeUnit`/`rebuild` 一致。
- **回归**：`anchor-backfill.test.ts` + 全量套件。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| IDF 现算每次 upsert 多 2 次 COUNT | SQLite COUNT 带索引，~µs；写入 ~1.8ms 无感 |
| `N` 变化致旧边权略陈旧 | 边权在重建/重写时刷新；启动 rebuild 全量重算 |
| 现有测试假设 `weight = sharedAnchors.size` | 检查并更新（若有） |

## 7. 涉及文件

- 修改：`gateway/src/graph/anchor-graph-store.ts`（`upsertUnit` 现算 IDF）
- 测试：`gateway/tests/unit/anchor-graph-store.test.ts`（新增）
