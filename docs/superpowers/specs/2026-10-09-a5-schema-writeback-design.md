# A5 抽象写回 schema（Schema Write-back）设计

> 日期：2026-10-09 ｜ 路线图：Phase H（`2026-10-09-remaining-roadmap-all.md`）｜ 脑依据：Bartlett 图式理论——
> 图式（gist）从原子经验中抽象出来后，原子经验应当**带着图式指针**留存（记忆的图式组织），
> 而不是图式与原子件互不相认。现状：S2 簇（`schema-clusters.ts`）只在 turnCompress prompt 里
> **呈现**相关簇（读路径），reflection 蒸馏出 gist 后（D1b）只对源 episodes 降能——
> **原子条目与 gist 之间没有链接**。

## 1. 问题

蒸馏链路现状（D1b）：`reflectSession` → `buildInsightUnit`（gist）→ `demoteSourceEpisodes`
（源 episodes energy ×0.3）。断链后果：

1. 检索命中原子 episode 时，模型**不知道存在已蒸馏的 gist 版本**——同一事实以两副面孔出现
2. 其他蒸馏路径（consolidation / reconsolidate D2）看不到「这些原子件已被哪个 gist 覆盖」，重复蒸馏
3. S2 簇的 representative 只是最高能成员，簇成员与 cluster 间无持久关系（每次现算）

## 2. 设计

### 2.1 回写语义（冲突体的裁决）

**成员带 gist 指针，非 supersede、非合并**：

```typescript
// HarmonicUnit / HarmonicIndexEntry 新增
/** A5: ids of gist units distilled FROM this entry. NOT a supersede chain —
 *  the member stays live & retrievable (multiple gists may share members). */
distilled_by?: string[];
```

| 冲突体 | 裁决 | 理由 |
|---|---|---|
| 原子条目 vs 抽象片段 | 成员保留原文 + 指针；gist 独立存在 | D1b 同款论证：多 gist 共享 episode，1:1 supersede 链会过度重定向 |
| 与 MinHash 合并 | **stamp 直写 OKF 不走 `store.write`** | 同内容改写会触发 MinHash 自匹配/邻居合并；镜像 `setPinned`/`setSticky` 的直写模式（读 frontmatter → 改 → 原子写回 → 更新 entry） |
| 与 soft-supersede | 正交共存：`distilled_by` ≠ `superseded_by`；成员被 supersede 时指针随文保留（历史） | supersede 是「事实被取代」，distill 是「事实被抽象」——两种关系 |
| 与 D1b 降能 | 共存：demote（energy）+ stamp（指针）同一趟完成 | 降能管淡忘，指针管溯源 |
| 指针上限 | `distilled_by` 追加去重，cap 3 | 防 frontmatter 无限膨胀（一集被 5 个 gist 引用时前 3 个够溯源自证） |

### 2.2 写入点

**reflection（主路径）**：`reflectSession` 每成功蒸馏一条 insight → 对该批次源 episodes
`stampDistilled(episodeIds, insightId)`（fail-open；批量直写）。

**consolidation merge（次路径，v1 不做）**：merge 产物 `merged_from` 已承载等价信息，不重复。

### 2.3 读出点（消费面）

1. **边界 recall 指针行**：命中条目带 `distilled_by` → 行尾追加 `↳ gist 已蒸馏（get_memory 可取）：<ids 尾 6 位>`——
   模型知道有更浓缩版本，按需取全文（指针式呈现，不占预算）
2. **reconsolidate（D2）候选对照**：`selectNewerRelated` 优先把同 cue 的 gist 作为改写证据
   （v1 只做排序提升：候选池里 `distilled_by` 指向的目标 gist 提前——实现留 D2 下一轮，本 spec 只留字段）

### 2.4 store 新 API

```typescript
HarmonicUnitFileStore.stampDistilled(ids: string[], gistId: string): number  // 实际 stamp 数
```

直写模式（镜像 setSticky）：entry 定位 → readOKFFile → `distilled_by: dedupeCap([...old, gistId], 3)` →
原子写回 → index entry 同步。fail-open 单条失败不影响其余。

## 3. 测试计划

1. `stampDistilled`：追加/去重/cap 3/未知 id 跳过/OKF round-trip/entry 同步
2. stamp **不触发 MinHash 合并**（stamp 后邻居关系不变——直写不进 write 管线）
3. reflection 集成：蒸馏成功 → episodes 的 OKF 带 gist id；蒸馏失败 → 不 stamp
4. 读出：指针行渲染 gist 提示（inject-format）；无指针条目不受影响
5. D1b 共存：demote 与 stamp 同趟、互不干扰

## 4. 边界

- 不持久化 S2 簇结构（clusters 仍现算——持久簇的失效维护成本 > 收益，指针是增量事实）
- 不做反向字段（gist 不记 `distilled_from`——`source_session_id` + D1b episode ids 已在 reflection 语境里，写进 gist 会膨胀 frontmatter）
- consolidation merge 路径不 stamp（`merged_from` 等价）
- 读出提示只在边界 recall 指针块（快照/pinned/notes 不加——预算敏感）
