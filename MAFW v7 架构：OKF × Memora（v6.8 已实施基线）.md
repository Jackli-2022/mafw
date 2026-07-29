# MAFW v7 架构：OKF 存储 × Memora 谐波记忆

> **基线声明**：v6.8（OKF 存储 + 谐波记忆 + 混合索引）已实施落地。
> v7 不是重写，而是在 v6.8 已实现代码上的演进：检索升级为策略引导、合并升级为主抽象语义、
> 能量升级为惰性计算、新增反馈闭环，并收紧"事实源 / 衍生品"边界。
>
> **核心哲学**：OKF 文件只装"人写的和 Agent 判定要写的内容"，一切可推导的数据归索引与工具层。

---

## 一、v6.8 → v7 变更总览

| 维度 | v6.8（已实施） | v7（本文档） |
| :--- | :--- | :--- |
| 存储 | OKF Markdown，每记忆一文件 | 不变 |
| 索引范围 | 主抽象 + 正文 | **收窄到抽象层** + 派生词项（索引内） |
| 分词 | 未定义 | **bigram**（中英混合前提） |
| 检索 | 线性一轮：BM25→锚点扩展→排序 | **策略引导迭代检索**（guided，默认） |
| 认知图谱 | 仅显式 [[link]] | 显式 + **IDF 加权隐式边** |
| 合并 | 写入时 MinHash | **主抽象三级阈值 + 冲突仲裁** |
| 能量 | decay.ts 定时批写 frontmatter | **惰性计算 + 重建结算**（删 decay.ts） |
| 日志 | 单一增量日志 | **双日志**：索引增量（可丢）+ 事件流（事实源） |
| 索引定位 | 可重建缓存 | **纯衍生品**：纯函数重建，内存为主 |
| 反馈 | 无 | **MemLoop 归因 + 锚点晋升 + Deferred Memory** |
| 蒸馏 | 按数量触发，一簇一条，事件摘要式输出 | **命题提取 + 知识信号门禁 + 质量门禁 + 增量合并** |
| L5 | 有目录，无检索路径 | 独立索引 + scope 参数 |
| 并发 | 未定义 | 单写者队列 + 容错解析 + 崩溃恢复 |
| 规模 | 未定义 | 三档演化路径（第十六节） |

---

## 二、架构全景

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                               MAFW v7 架构全景                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                          应用层（MCP 工具接口）                               │  │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────────┐ │  │
│  │  │mafw_search│ │mafw_write_│ │mafw_      │ │mafw_      │ │mafw_status      │ │  │
│  │  │(策略引导) │ │memory     │ │resolve_   │ │rebuild_   │ │(能量排行·读时)  │ │  │
│  │  │           │ │(三级合并) │ │merge(仲裁)│ │index      │ │                 │ │  │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────────────┘ │  │
│  │  v6.8 已有工具接口保持兼容，新增 resolve_merge / status                       │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                             │
│                                       ▼                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │              检索层（策略引导检索器，IDF 感知）                               │  │
│  │                                                                               │  │
│  │  guided 迭代循环（max 3 轮，硬 token 预算 2000）：                            │  │
│  │    ① BM25(bigram) 检索抽象层索引                                              │  │
│  │       字段：primary_abstraction(1.0) + cue_anchors(0.8) + 派生词项(0.4)       │  │
│  │    ② 质量评估 → 锚点改写扩展（跳过低 IDF 噪声锚点）                           │  │
│  │    ③ 图上多跳（显式边 1.0 / 隐式边 0.5×IDF 归一化，1 跳 top-5）               │  │
│  │  停止：score 饱和 / 轮次用尽 / 预算耗尽                                       │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                             │
│                                       ▼                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │        索引层（纯衍生品：输入 .md 文件 → 纯函数 → 索引，可丢弃重建）          │  │
│  │                                                                               │  │
│  │  内存索引（主） + .harmonic_index.json（冷启动加速快照，可选落盘）            │  │
│  │  .harmonic-index.log（索引增量，与索引条目同构，可随时丢弃）                  │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                             │
│                                       ▼                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                   存储层（唯二事实源）                                        │  │
│  │                                                                               │  │
│  │  ① OKF Markdown 文件 —— 记忆本体（人/Agent 显式写入的内容）                   │  │
│  │  ② .memory-events.log —— access / miss / 归因事件流（遥测，不可推导）         │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                             │
│                                       ▼                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │              反馈层（MemLoop 归因 + 锚点晋升 + Deferred Memory）              │  │
│  │                                                                               │  │
│  │  miss_cause=anchor_poor       → 候选锚点待审队列 → 晋升 cue_anchors           │  │
│  │  miss_cause=irrelevant_memory → energy_base 下调                              │  │
│  │  T1 observations → 延迟成忆（引用/达阈值才蒸馏，否则淘汰）                    │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、表示层：OKF Frontmatter（只装显式内容）

```markdown
---
# ===== Memora 表示层（进索引） =====
primary_abstraction: "createPayment: 创建支付订单"   # ① 主抽象（6-8词，权重 1.0）
cue_anchors: [payment, create, order, channel]      # ② 线索锚点（仅显式/已晋升，0.8）

# ===== 系统层（不进索引） =====
energy_base: 0.7                                    # ③ 基础能量（惰性衰减基准）
salience: 0.8                                       # ④ 显著性（注入排序）
review_count: 3                                     # ⑤ 复习计数（重建时结算）
last_reviewed: 2026-07-15                          # ⑥ 上次复习（衰减时间基准）
archived: false                                     # ⑦ 归档状态

# ===== 关联层 =====
links:
  - [[PaymentService]]                              # ⑧ 显式图边

# ===== 蒸馏层 =====
granularity: function
abstraction_level: 2
distilled_from: [init]
merged_from: [mem_023, mem_045]
aliases: [create-payment-v1]                       # ⑨ 别名（rename/合并后解析旧链接）

# ===== 预留扩展 =====
vector: null                                        # ⑩ 主抽象 embedding（可选启用）

created_at: 2026-07-15T10:00:00Z
updated_at: 2026-07-16T14:20:00Z
---

# createPayment        ← memory value（不进索引；仅重建时抽取派生词项，不回写）
```

**frontmatter 纪律（v7 新增，防止回潮）：**

| 禁止写入 | 替代方案 |
| :--- | :--- |
| `derived_anchors`（正文派生词） | 只活索引内，重建纯函数生成；固化走"晋升"动作 |
| `energy_effective_snapshot` | `mafw status` / Dashboard 读时展示 |
| `suggested_anchors` | 进待审队列文件，晋升后才成为正式 cue_anchors |

---

## 四、检索层：策略引导检索（IDF 感知）

### 4.1 接口

```text
mafw_search(query,
            policy: "oneshot" | "guided" = "guided",
            scope: "project" | "global" | "both" = "project",
            budget_tokens: 2000)

oneshot：v6.8 行为（兼容旧调用、低延迟场景）
guided：迭代导航（默认）——Memora 的核心能力，多跳推理的主要来源
```

### 4.2 guided 流程

```text
第 1 轮：BM25(bigram) 检索抽象层索引
    │  字段权重：primary_abstraction 1.0 / cue_anchors 0.8 / 派生词项 0.4
    ▼
命中质量评估：
    出结果：top1_score ≥ θ_sat，或结果数 ≥ 3 且 score 方差小
    继续：零结果 / top1_score < θ_low / 结果互相矛盾
    ▼
第 2 轮：锚点改写扩展
    │  先做 IDF 过滤：IDF < θ_idf 的噪声锚点不参与改写
    ▼
第 3 轮：图上多跳（1 跳，top-5）
    │  显式边 1.0；隐式边 0.5 × (IDF/maxIDF)；超节点中转
    ▼
全局停止：score 饱和 / 3 轮用尽 / token 预算耗尽
    ▼
排序：score = BM25 × (0.5 + 0.5 × energy_effective) × hop_decay
    hop_decay：第 1 轮 1.0 / 第 2 轮 0.9 / 第 3 轮 0.75
```

### 4.3 副作用事件（写事件日志，不碰 .md 文件）

```jsonl
{"op":"access","id":"mem_001","round":1,"score":0.83,"ts":1700000300}
{"op":"miss","query":"支付幂等性","miss_cause":"anchor_poor","ts":1700000400}
```

---

## 五、索引层：纯衍生品 + 双日志分离

### 5.1 事实源 vs 衍生品

| 文件 | 性质 | 丢失后果 |
| :--- | :--- | :--- |
| `**/*.md`（OKF） | **事实源** | 真丢失 |
| `.memory-events.log` | **事实源**（遥测事件流） | 丢失反馈历史，能量结算回退 |
| `.harmonic_index.json` | 衍生品（冷启动快照） | 内存重建，秒级恢复 |
| `.harmonic-index.log` | 衍生品（索引增量） | 随时可丢弃重建 |
| `.cognitive_graph.json` | 衍生品 | 重建恢复 |
| `.index-meta.json` | 衍生品 | 重建恢复 |

**重建是纯函数：`f(所有 .md 文件) → 索引 + 图谱`。崩溃恢复极简：两类事实源在，系统可完整复原。**

### 5.2 双日志格式

索引增量（衍生品，条目与索引同构）：

```jsonl
{"op":"write","id":"mem_001","entry":{"primary":"...","anchors":[...],"terms":["创建","建支","支付",...],"derived":["PaymentService","orderId"]},"ts":1700000000}
{"op":"archive","id":"mem_001","ts":1700000100}
{"op":"rename","id":"mem_001","slug":"create-payment-v2","ts":1700000500}
```

事件流（事实源）：

```jsonl
{"op":"access","id":"mem_001","round":1,"score":0.83,"ts":1700000300}
{"op":"miss","query":"支付幂等性","miss_cause":"anchor_poor","ts":1700000400}
{"op":"suggest_anchors","id":"mem_001","candidates":["idempotent","retry"],"ts":1700001000}
```

### 5.3 重建流程

```text
触发（任一）：
  - gateway 启动检测 last_rebuild > 24h（替代不可靠的 Cron）
  - 增量索引日志 > 500 条
  - 手动 mafw rebuild-index --force

执行（纯函数 + 事件结算）：
  ① 扫描全部 .md（孤儿检测：有文件无记录 → 补录）
  ② bigram 分词，构建抽象层索引 + 正文派生词项（不回写 .md）
  ③ 计算锚点 IDF → 构建认知图谱（显式 + IDF 加权隐式边）
  ④ 结算事件日志中的 access → 回写 .md（review_count/last_reviewed/energy_base）
     ★ 唯一合法的批量回写点；结算后事件日志写快照头并轮转归档
  ⑤ 悬空链接检测 → 警告写入 .index-meta.json
  ⑥ 清空增量索引日志，更新 last_rebuild
```

---

## 六、认知图谱：IDF 加权双轨边

```text
图边 = 显式边 + 隐式边
  显式边：[[link]]            权重 1.0（人工/蒸馏指定）
  隐式边：共享 cue_anchor      权重 0.5 × (IDF / maxIDF)

IDF(anchor) = log(N / n)，N=记忆总数，n=含该锚点的记忆数

噪声锚点治理（θ_idf 三处共用）：
  · 建边：IDF < θ_idf → 不建隐式边
  · 遍历：图扩展不经过噪声锚点
  · 检索：guided 第 2 轮改写不采用噪声锚点

超节点兜底：IDF 正常但绝对数量 > 20 → 转枢纽节点中转（防组合爆炸）
别名解析：[[link]] 先按 slug，未命中查 aliases，仍悬空 → 重建警告
```

---

## 七、写路径：三级合并 + 冲突仲裁

**原则：合并是破坏性操作，拆分+互链是非破坏性的——默认永远站在非破坏性一边。**

```text
mafw_write_memory(content)
    │
    ▼
第 1 级：主抽象相似度（候选生成走索引 top-50，不全库扫描）
    ├─ > 0.92        → 自动合并（极高置信才动手）
    │                   正文合并、anchors 并集、merged_from + aliases 记录
    ├─ 0.75 – 0.92   → 不合并，返回 conflict 信号：
    │                   { conflict, existing_id, existing_abstraction,
    │                     similarity, diff_summary }
    │                   Agent 调用 mafw_resolve_merge 仲裁：
    │                     "merge" / "link"（独立+互链）/ "abstract"（建父节点）
    │                   Loop 内无人仲裁的超时默认："link"（安全默认）
    └─ < 0.75        → 第 2 级
    ▼
第 2 级：正文 MinHash（LSH 分 band 取候选，非全库比对）
    > 0.95        → 自动合并（记 merged_from + aliases）
    0.80 – 0.95   → 不合并，互加 [[link]]
    < 0.80        → 正常新建
    ▼
写 .md → fsync → 追加增量索引日志（单写者队列）→ 返回
```

---

## 八、能量系统：惰性计算 + 读时可见

```text
查询时（零写入）：
  energy_effective = energy_base × decay_factor(now - last_reviewed)
                   + access_boost(近期 access 事件数)，封顶 1.0

重建时（唯一批量回写点）：
  access 事件结算进 energy_base / review_count / last_reviewed
  已结算事件写快照头，日志轮转归档（events.YYYY-MM.log.gz）

读时可见性：
  mafw status  → 能量排行（top 活跃 / 濒临衰减 / 零访问）
  Dashboard    → 同数据源图形化
```

**decay.ts 删除**——v6.8 中它每次运行批量改 frontmatter → 灌增量日志 → 触发重建 → 再衰减，是自激写放大源。

---

## 九、反馈层：MemLoop + 锚点晋升 + Deferred Memory + 蒸馏管道

### 9.1 miss_cause 双因归因

```text
来源 A：Review Agent 标注（Loop Review 失败时归因写入）

来源 B：自动判定（免费信号）
  记忆事后被任务实际使用（出现在后续工具调用/产出中），
  但当轮检索未命中 → 自动判定 anchor_poor
  （知识在库、导航未到，因果清晰，零标注成本）

处置分流：
  anchor_poor       → 候选锚点（miss 查询词 + 该记忆派生词）→ 待审队列
  irrelevant_memory → energy_base 下调（真正的降噪）
```

### 9.2 锚点晋升管道

```text
.suggested-anchors.json（待审队列）
    │
    ▼ Agent 审核（Loop 间隙 / SessionStart 批量处理）
    ├─ 采纳 → 晋升正式 cue_anchors（写 frontmatter，权重 0.8）
    └─ 拒绝 → 移除 + 记录拒绝事件防重复建议

复用同一管道：正文派生词中被频繁命中的 derived_terms → 建议固化
```

### 9.3 Deferred Memory（T1 延迟成忆）

```text
observations/ = 延迟中的记忆，不进索引
  晋升：被引用 / 同主题积累 ≥ 3 条 → 进入蒸馏管道（见 9.4）
  淘汰：5 个 Loop 未被引用且无知识信号 → 归档清理
```

### 9.4 蒸馏管道：命题提取与质量门禁（T1→T2 是知识沉淀，不是事件摘要）

**核心原则：T1 是情景记忆（发生了什么），T2 是语义记忆（可复用的知识是什么）。
压缩的正确性不在于"N 条变 1 条"，而在于内容类型必须发生跃迁——
叙事体（主语是"用户/Agent"）进，陈述体（结论/方法/位置/坑）出。**

```text
observations（情景层，原始事件）
    │
    ▼ ① 预去重
    │   按 fingerprint（工具 + 目标文件 + 动作）归并重复记录
    │   （同一事件的多条重复 obs 先去重，再参与聚类）
    ▼
    ② 知识信号检测（蒸馏门禁，不满足则继续 Deferred）
    │   存在以下任一信号才触发蒸馏：
    │     · 错误 + 根因 + 修复          → pitfall 型
    │     · 配置/代码修改 + 验证生效     → procedure 型
    │     · 反复出现的位置/契约事实      → fact 型
    │     · 决策 + 理由                  → decision 型
    │   只有"做了什么"没有"学到什么"的簇 → 留在 T1 等淘汰
    ▼
    ③ 命题提取（一簇可出多条，禁止"一簇一条"硬映射）
    │   每条候选 = { 命题（陈述句）, 类型, 位置锚点(文件:函数), 证据obs[] }
    │   蒸馏产物 2-4 条 T2，各带各的 distilled_from
    ▼
    ④ 主抽象生成 + 校验
    │   从命题生成；必须是可复用结论（回答"学到什么"）
    │   禁止与 title 复读（title 回答"做了什么"）
    ▼
    ⑤ 质量门禁（不过则退回重写或降级留 T1）
    │   □ 正文无"用户/Agent/然后/最终"等叙事主语
    │   □ 含至少一条可复用结论（陈述句）
    │   □ granularity 与内容类型一致（procedure/pitfall/fact/decision）
    │   □ abstraction_level = 2（T2 法定值）
    │   □ cue_anchors 与正文实体互相覆盖
    ▼
    ⑥ 增量蒸馏（对齐第七节合并语义）
        该主题已有 T2 → 新命题走三级合并（>0.92 自动并入既有 OKF）
        而不是每次蒸馏都新建文件
```

**蒸馏质量回溯（闭环）：**
T2 长期零 access，或反复 `miss_cause=anchor_poor` → 回溯标记该次蒸馏质量差，
记入事件日志，作为蒸馏器提示词/规则的调优信号。
蒸馏器和检索器共用同一套评价体系（access / miss），闭环才完整。

**合格 T2 示例（对照）：**

```markdown
---
type: knowledge
title: 观测插件上下文注入内容的方法
primary_abstraction: "messages-transform hook 加打印可观测注入内容"
cue_anchors: [上下文注入, debug, messages-transform, hook]
granularity: procedure
abstraction_level: 2
distilled_from: [去重后的 14 条 obs id]
---

## 结论
- 注入点：`src/hooks/task-loop.ts` 的 messages-transform hook
- 观测方法：在注入函数入口加 `console.log` 打印消息体
- 开关：`src/config.ts` 中 debug 配置项控制输出

## 验证
改后 `npm run build` 重载插件即生效（2026-07-20 验证）
```

---

## 十、L5 全局记忆

```text
~/.mafw/l5/ 独立索引（结构相同，同为纯衍生品）

mafw_search(scope=both) 合并排序：
  score_l5 = score × 1.2（公理/启发式优先），结果标注 [L5]

SessionStart 注入：
  salience × energy_effective 排序，硬预算 500 tokens
  超出部分一行提示："还有 N 条，可用 mafw_search(scope=both) 查询"
```

---

## 十一、并发与一致性

| 风险 | 对策 |
| :--- | :--- |
| 并发写交错（Windows append 非原子） | gateway 单写者队列；文件锁兜底 |
| 日志坏行 | 容错解析：跳过 + 告警 |
| 写 .md 与写日志间崩溃 | 顺序：.md → fsync → 日志；重建孤儿扫描 |
| 索引整体损坏/丢失 | 无所谓——纯衍生品，纯函数重建 |
| 事件日志损坏 | 事实源，纳入备份；单行损坏容错跳过 |
| 上下文爆炸 | 检索 2000 / 注入 500 / 图跳 1 跳 top-5 |
| 噪声锚点污染 | IDF 三处共治 |
| 误合并污染正文 | 三级阈值 + 默认 link + merged_from 可溯 |

---

## 十二、目录结构

```text
.mafw/
├── memory/
│   ├── concepts/
│   │   ├── knowledge/    ├── semantic/    └── procedural/
│   ├── observations/                       # T1 延迟成忆（不进索引）
│   │   └── 2026-07-21.jsonl
│   ├── .harmonic_index.json                # ◇ 衍生品：冷启动快照
│   ├── .harmonic-index.log                 # ◇ 衍生品：索引增量（可丢）
│   ├── .memory-events.log                  # ★ 事实源：事件流
│   ├── .suggested-anchors.json             # ◇ 待审锚点队列
│   ├── .index-meta.json                    # ◇ 衍生品：元数据/悬空警告
│   └── .cognitive_graph.json               # ◇ 衍生品：IDF 加权图谱
├── .seeded
└── state/
    └── {goalId}.json                       # Phase 状态 + Review 归因标签

~/.mafw/l5/                                 # L5 全局（OKF + 独立索引，同构）
└── concepts/
    ├── axioms/  ├── heuristics/  └── gateway/
```

---

## 十三、组件清单（基于 v6.8 已实施代码）

### 新增

| 文件 | 职责 |
| :--- | :--- |
| `gateway/src/retrieval/guided-retriever.ts` | 策略引导迭代检索 |
| `gateway/src/retrieval/idf-stats.ts` | 锚点 IDF，三处共用 |
| `gateway/src/memory/derived-terms.ts` | 正文派生词抽取（标题/代码实体/TF-IDF top3） |
| `gateway/src/memory/event-log.ts` | 事件日志（事实源）：append/容错读/轮转归档 |
| `gateway/src/memory/write-queue.ts` | 单写者队列 |
| `gateway/src/memory/abstraction-matcher.ts` | 主抽象三级相似度 + conflict 信号 |
| `gateway/src/graph/anchor-graph.ts` | 锚点倒排 + IDF 加权隐式边 + 超节点 |
| `gateway/src/feedback/miss-attribution.ts` | miss_cause 自动判定 |
| `gateway/src/feedback/anchor-promotion.ts` | 待审队列 + 晋升管道 |
| `gateway/src/feedback/deferred-memory.ts` | T1 晋升/淘汰 |
| `gateway/tools/mafw-resolve-merge.ts` | 合并仲裁（merge/link/abstract） |
| `gateway/tools/mafw-status.ts` | 能量排行读时展示 |

### 修改（v6.8 已有）

| 文件 | 变更 |
| :--- | :--- |
| `mafw-search.ts` | policy/scope 参数 + guided 流程 |
| `mafw-write-memory.ts` | 两级合并 → 三级 + 仲裁；候选生成走索引/LSH |
| `increment-log.ts` | 拆分：索引增量（衍生品）+ 事件日志（事实源）；容错解析 |
| `index-builder.ts` | 纯函数化；bigram；收窄抽象层 + 派生词；孤儿/悬空检测 |
| `cognitive-graph.ts` | 显式 + IDF 加权隐式边 |
| `abstraction-distiller.ts` | 重写为命题提取管道（见 9.4：去重→信号门禁→命题→校验→增量合并） |
| `HarmonicUnit` 类型 | +`energy_base`/`aliases`/`vector?`；`energy` 改查询时计算 |
| SessionStart 注入 | 排序 + 500 token 硬预算 |

### 删除

| 文件 | 原因 |
| :--- | :--- |
| `decay.ts` | 惰性衰减取代，消除自激写放大 |

---

## 十四、特征对照

| 特征 | v7 载体 | 状态 |
| :--- | :--- | :--- |
| 主抽象（6-8词） | frontmatter，权重 1.0 | ✅ |
| 线索锚点 | frontmatter，权重 0.8，仅显式/已晋升 | ✅ |
| 派生词项 | 索引内 only，权重 0.4 | ✅ |
| 记忆值不索引 | 正文，命中后按需加载 | ✅ |
| 策略引导检索 | guided retriever，IDF 感知 | ✅ |
| 认知图谱 | 显式 1.0 + 隐式 0.5×IDF + 超节点 | ✅ |
| 主抽象合并 | 三级阈值 + 仲裁（默认 link） | ✅ |
| 能量系统 | 惰性计算 + 重建结算 + 读时可见 | ✅ |
| MemLoop | miss_cause 双因 + 自动判定 + 晋升管道 | ✅ |
| Deferred Memory | T1 延迟成忆 | ✅ |
| 事实源 | OKF 文件 + 事件日志（唯二） | ✅ |
| 向量混合检索 | vector 字段预留 | ⏳ |

---

## 十五、迁移计划（v6.8 → v7）

```text
阶段 1（索引与检索层，不动存储，可随时回退）：
  1. bigram 分词 + 索引收窄到抽象层 + 派生词项
  2. 双日志拆分
  3. guided retriever + IDF 共治 + 预算控制
  4. IDF 加权隐式边 + 超节点

阶段 2（写路径 + 反馈）：
  5. 惰性衰减（删 decay.ts）+ 事件结算与轮转
  6. 三级合并 + mafw_resolve_merge
  7. miss_cause 归因 + 锚点晋升管道
  8. Deferred Memory
  9. mafw status + Dashboard 能量面板

阶段 3（可选）：
  10. 主抽象 embedding + RRF 混合检索

验收：20-50 条历史真实查询回归集，precision@5 每阶段不允许退化。
```

---

## 十六、规模演化路径

**前提：增长异常首先是质量问题（合并太松/淘汰未生效），不是容量问题。**

| 量级 | 瓶颈 | 对策 |
| :--- | :--- | :--- |
| ~1万 | 合并检测 O(N) 全库扫描；事件日志膨胀 | 候选生成索引化：MinHash→LSH 分 band、抽象比对走索引 top-50；事件结算即截断轮转 |
| ~10万 | 检索质量退化（低能量近重复挤占 top-k）；全量重建成本 | **热度分层**：hot（能量>θ 或 90 天有 access，内存索引，guided 只查这层）/ warm（磁盘索引，hot 零命中降级查）/ cold（不索引）；mtime/hash 增量重建；索引落盘格式换 SQLite（衍生品，零迁移成本） |
| >10万/多项目 | 单库混杂多域 | **域分片**：L5 按技术域子索引；检索先路由分片（每分片一条库级主抽象——Memora 机制递归复用） |

原则：hot 层靠能量机制 + Deferred Memory 双重把关，规模天然收敛在数千条；
扩容的本质不是容纳更多记忆，而是让该沉底的沉底。全程不动 OKF 事实源。

---

## 十七、最终决策总结

| 决策项 | v7 选择 |
| :--- | :--- |
| 存储格式 | OKF Markdown（沿用 v6.8） |
| 事实源 | OKF 文件 + 事件日志（唯二） |
| 索引定位 | 纯衍生品，纯函数重建，内存为主 |
| 日志架构 | 双日志：索引增量（可丢）+ 事件流（事实源） |
| 索引字段 | 抽象 1.0 + 锚点 0.8 + 派生词 0.4（索引内） |
| 分词 | bigram |
| 检索模式 | guided 策略引导（默认）+ oneshot 兼容 |
| 图谱 | 显式 + IDF 加权隐式边 + 超节点 |
| 合并策略 | >0.92 自动 / 0.75-0.92 仲裁 / 默认 link |
| 能量系统 | 惰性计算 + 重建结算 + 读时可见 |
| 反馈 | miss_cause 双因 + 自动判定 + 晋升管道 + Deferred Memory |
| frontmatter 纪律 | 只装显式内容，派生/动态值一律不入 |
| L5 | 独立索引 + scope + 1.2 加权 |
| 并发 | 单写者队列 + 容错解析 + 崩溃恢复 |
| 预算 | 检索 2000 / 注入 500 / 图跳 1 跳 top-5 |
| 规模 | 候选索引化（1万）→ 热度分层（10万）→ 域分片（更多） |
| 工具接口 | 兼容 v6.8，+resolve_merge / status |

---

**MAFW v7 = 两类事实源（OKF + 事件流），一个纯函数（重建），**
**三条闭环（检索反馈、锚点晋升、延迟成忆），三档规模演化。**
**事实源最小化，衍生品可弃化，反馈信号可行动化，扩容不动存储。**
