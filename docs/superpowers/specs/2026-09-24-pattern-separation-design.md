# 模式分离 guard（Pattern Separation Guard）：脑式重构 S4

> 日期：2026-09-24 · 状态：设计待审
> 范围：给 S1 写时路由加「显式分离」分支，防过度合并（同题但**身份不同**的记忆不得合并）
> 依据：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.2G（DG 模式分离）、§2.3（模式分离在 AI 系统基本缺席）、AutoViewMem `2609.21940`（写时低重叠视图抗干扰）
> 相关：`2026-09-24-write-time-routing-design.md`（S1）、`2026-09-23-memory-dual-system-restructure-design.md` §3.4（纯 cosine 合并已证伪）

## 1. 背景与诊断

### 1.1 现状与风险
S1 的写时路由 + 现有 MinHash 合并，方向都是**"相似即合"**——与大脑齿状回（DG）的**模式分离**（把相似输入正交化）**相反**。已知反例（伞形 spec §3.4）：cos 0.995 的两条记忆实为**不同实体**，LLM 判 `create`；若用确定性阈值合并 → **过度合并**（Memora 实证会降质）。

**当前判官只有二值**（`consolidation-service.ts` 的 `JudgeVerdict`：`update | create`）：
- `update` = 同一实体/主题的演化 → 合并（对）。
- `create` = 仅措辞相似 → 分开（对）。
- **缺失**：语义高度相近、但**需要显式区分**（如"部署到 us-east-1" vs "部署到 eu-west-1"）——现有 `create` 虽不合并，但**不保证检索时能区分**（两条会互相挤压/混淆）。

### 1.2 脑对照缺口
DG 模式分离 = **去相关**相似经验，使它们不互相干扰；CA3 模式完成 = 从部分线索补全整体。二者**平衡**。MAFW 只有"完成"（合并/图扩展），**无"分离"**。

## 2. 目标 / 非目标

**目标**
1. 判官输出从二值扩为**三值**：`update` / `create` / `separate`。
2. `separate` = 语义相近但身份不同 → **强制不合并** + **写入时注入区分信号**（消歧锚点 / `distinct_from` 标记），检索时保留可区分性。
3. 可观测 `separateRatio`。

**非目标**
- 不做表示级正交化（AutoViewMem 式多视图重写）——过重；本切片用**判定 + 标记**的轻方案。
- 不改检索排序算法（仅新增可区分信号）。
- 不覆盖 S1 已有的 create/update 分支。

## 3. 设计

### 3.1 三值判官
`JUDGE_SYSTEM` 与 `JudgeVerdict` 扩为：
```ts
type JudgeVerdict = { action: 'update'; target_id?: string }
                   | { action: 'create' }
                   | { action: 'separate'; target_id?: string; distinction?: string };
```
判据（prompt 明确）：
- `update`：同一实体/主题的演化/补充（值变了但主体同一）。
- `separate`：**主体不同但高度相似**（同维度不同实例、同结构不同取值）——需保留两条并互相区分。
- `create`：仅表面相似，无关。

### 3.2 分离的落地（写入时）
`separate` 分支：
1. **不合并**、不 supersede；照常写入新条目。
2. **注入区分信号**：
   - `cue_anchors` 追加**区分性锚点**（判官给出的 `distinction` 关键词，或从两条差异 token 提取）。
   - 新条目 frontmatter 标 `distinct_from: [targetId]`（记录"此条与 X 相似但不同"）。
3. **检索保留可区分性**：`searchScored` 命中一对 `distinct_from` 时，**不互相挤压**（可选：轻微 penalty 互斥，或保证两条都可返回）。

### 3.3 与 S1 的关系
S1 路由 `θ_cand ≤ cos < θ_dup` 分支 → 调判官 → 现在返回三值：
- `update` → 合并（S1 原逻辑）。
- `create` → 新建（S1 原逻辑）。
- `separate` → 新建 + 区分信号（本切片新增）。
- `cos ≥ θ_dup` 的 `skip` **保持不变**（近似精确重复）；但需注意：`skip` 不应吞掉 `separate` 情形——θ_dup 取 0.95 足够高，跨实例差异通常 < 0.95。

## 4. 测试与验收

- **单测** `judge-verdict.test.ts`：三值解析、未知值回退、缺 target_id 处理。
- **单测** `separation.test.ts`：`separate` 不合并、注入 `distinction` 锚点、`distinct_from` 写入。
- **集成**：写"部署 us-east-1" + "部署 eu-west-1"（cos 高）→ 判 `separate` → 两条都在、锚点可区分、检索两条都能命中。
- **回归**：S1 的 create/update 行为不变。
- **验收**：`separateRatio > 0`（存在需要分离的写入）；无过度合并回归（不同实体不合并）。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 判官三值混淆（separate vs create） | prompt 给清晰判据 + 少量 few-shot 示例；未知 → 回退 create（安全） |
| `distinct_from` 信号被检索忽略 | 显式加检索测试断言"两条都可返回" |
| 分离过多 → 碎片回升 | 与 S1 的 UPDATE 协同；`separate` 仅在高相似+身份不同时触发 |

## 6. 涉及文件

- 修改：`gateway/src/memory/consolidation-service.ts`（判官三值 + separate 分支）、`gateway/src/memory/route-write.ts`（S1，接 separate）、`gateway/src/core/memory/harmonic-index.ts`（`distinct_from` 检索处理，可选）、`gateway/src/core/memory/harmonic-types.ts`（`distinct_from` 字段）
- 测试：`gateway/tests/unit/memory/judge-verdict.test.ts`、`separation.test.ts` + 集成

## 7. 依赖与分解

- **强依赖 S1**（在其路由分支上扩展）；建议紧随 S1 实现（S1 → S4）。
- `distinct_from` 检索处理可拆为后续微切片（先写入标记，再检索消费）。
