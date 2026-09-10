这是根据上一轮讨论生成的 **MAFW v6.0 完整架构文档**，已整理为标准 Markdown 格式，可直接保存为 `MAFW_Architecture_v6.0.md` 使用。

```markdown
# MAFW (Multi-Agent Framework) 系统架构 v6.0

> **代号**："Aligned Spiral"（对齐螺旋）  
> **设计哲学**：从“执行器”转向“对齐器”。系统不仅执行 Goal，更在**用户偏好、成本预算、历史经验**三者间动态寻求最优解。  
> **核心升级**：自适应螺旋模型（Adaptive Spiral） + 认知路由（Cognitive Routing） + 经济可观测性（Economic Telemetry）。

---

## 1. 系统全景 v6.0

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MAFW v6.0 全景 (Aligned Spiral)                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────── 用户交互层 (User Alignment Layer) ───────────────────────┐  │
│  │  • 细粒度反馈 (Wave点赞/踩)  • 实时拖拽纠偏  • 动态目标权重滑块           │  │
│  └──────────────────────────────┬───────────────────────────────────────────┘  │
│                                 │ (Feedback -> Energy Weight x2.0)             │
│  ┌──────────────────────────────┴───────────────────────────────────────────┐  │
│  │                      OpenCode Runtime (编排层)                            │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │  │
│  │  │Plan Agent  │  │Execute Agent│  │Review Agent│  │  Cognitive      │  │  │
│  │  │(规划+回溯) │  │(执行+路由) │  │(验证+冲突) │  │  Router (新)     │  │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────────┬─────────┘  │  │
│  │        │               │               │                  │              │  │
│  │        └───────────────┴───────────────┴──────────────────┘              │  │
│  │                                   │                                       │  │
│  │                          ┌────────┴────────┐                             │  │
│  │                          │  Gateway v6.0   │  ← 向量时钟 + 乐观锁        │  │
│  │                          │  (Node.js)      │                             │  │
│  │                          └────────┬────────┘                             │  │
│  └───────────────────────────────────┼─────────────────────────────────────┘  │
│                                      │                                         │
│  ┌───────────────────────────────────┼─────────────────────────────────────┐  │
│  │        MAFW Plugin v6.0 (核心能力层)                                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │ Hook Handler │  │ Tools API    │  │  Storage     │  │Dashboard  │  │  │
│  │  │ (含中断捕获) │  │ (含路由/反馈)│  │ (OCC+Snapshot)│  │(经济视图) │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └───────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                         │
│  ┌───────────────────────────────────┼─────────────────────────────────────┐  │
│  │      记忆系统 v6.0 (Energy-Aware Graph)                                   │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │  用户反馈权重 + 自动衰减 = 动态能量 (现役/归档/遗忘)              │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 执行模型：自适应螺旋（Adaptive Spiral）

v5.0 的线性 Loop 升级为**带回溯机制的双向螺旋**。

### 2.1 核心概念变更

| v5.0 概念 | v6.0 概念 | 升级说明 |
| :--- | :--- | :--- |
| **Loop** | **Spiral** | 不再是简单重试，每次新圈可自动裁剪/扩展 Wave 粒度 |
| **Wave (顺序)** | **Wave (动态)** | 支持 **Checkpoint 回溯**：若 Wave N 失败，自动回滚至最近 Checkpoint |
| **PASS/FAIL** | **SCORE (0-100)** | 结合覆盖率、成本效率、用户偏好权重的综合评分 |
| **Plan Agent** | **Plan & Reflect Agent** | 除规划外，负责分析“为何用户中断/纠偏” |

### 2.2 生命周期（含中断处理）

```
Goal Created + User Priorities (Speed/Quality/Cost Slider)
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  Spiral N 启动                                           │
│  Step 1: Plan Phase (注入用户权重 + 失败模式)            │
│  Step 2: Execute Waves (逐 Wave，每步 Checkpoint)        │
│      │                                                   │
│      ├─── [正常] ──► 继续                               │
│      ├─── [用户中断修改代码] ──► 触发 Hook              │
│      │    └─► Plan Agent 增量重规划 (非全量)            │
│      └─── [成本超预算 120%] ──► Cognitive Router 降级   │
│                             模型 (e.g., Haiku)            │
│  Step 3: Review Phase (Multi-dimension Score)            │
└──────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────┐     ┌─────────────────────────────────────┐
│ SCORE ≥ 85   │     │ SCORE < 85 或 用户撤回             │
│ (自动提交)   │─────│ (触发 Spiral N+1，带回溯点)       │
└──────────────┘     └─────────────────────────────────────┘
```

---

## 3. 记忆系统 v6.0：能量-对齐知识图谱（Energy-Aligned Graph）

### 3.1 记忆分层（新增“用户能量系数”）

| 层级 | 内容 | 能量计算逻辑（v6.0 新公式） |
| :--- | :--- | :--- |
| **T1 工作记忆** | 原始 Tool/File/LLM 观察 | `E = 0.5`（固定，仅用于 Diff 压缩） |
| **T2 情景记忆** | Loop 叙事摘要 | `E = 0.5 + (Score/100)*0.3 - 0.01/天` |
| **T3 语义记忆** | Facts / Concepts | `E = 基础能量 + 0.2 * (用户点赞数)` |
| **T4 过程记忆** | 工作流模式 | `E = 成功率 + 0.15 * (被路由选用次数)` |
| **L3 参数化约束** | 必须/禁止规则 | **若用户手动标记“锁定”，则 E = 1.0（不可删除）** |

### 3.2 记忆生命周期（新增混合压缩器）

```
T1 原始观察 (累积 > 50条)
       │
       ▼
┌──────────────────────────────────────────────┐
│  混合压缩器 (Hybrid Compressor) - 新         │
│  ├─ 若为重复文件 Diff → 算法压缩 (免费)      │
│  └─ 若为语义推理 → 调用 LLM 压缩 (付费)      │
└──────────────────────────────────────────────┘
       │
       ▼
T2 + T3 (存储至知识图谱)
       │
       ▼ (用户反馈介入)
┌──────────────────────────────────────────────┐
│  能量加权 & 路由索引更新                      │
│  - 高能量 (>0.8) → 注入 System Prompt        │
│  - 中等 (0.5-0.8) → 仅 Tool 检索可见        │
│  - 低能量 (<0.3) → 归档 (不删除，可恢复)    │
└──────────────────────────────────────────────┘
```

---

## 4. Tools 接口清单（v6.0 新增与升级）

### 4.1 用户交互与反馈（新增）

```typescript
// 1. mafw_ask_user — 主动向用户发起澄清（取代静默失败）
{
  name: "mafw_ask_user",
  description: "Ask user a clarifying question when uncertainty > 70%.",
  parameters: {
    question: { type: "string" },
    options: { type: "array", optional: true },
    priority: { type: "string", enum: ["blocking", "non-blocking"] }
  }
}

// 2. mafw_record_feedback — 记录用户点赞/点踩（自动加权）
{
  name: "mafw_record_feedback",
  description: "Record user feedback for a specific Wave or Artifact.",
  parameters: {
    targetId: { type: "string" }, // e.g., wave-2
    type: { type: "string", enum: ["thumbs_up", "thumbs_down", "correction"] },
    comment: { type: "string", optional: true }
  }
}
// 内部逻辑：若 thumbs_up → 相关记忆 Energy += 0.2；若 thumbs_down → Energy -= 0.1
```

### 4.2 认知路由与成本控制（新增）

```typescript
// 3. mafw_get_model_route — 动态决定使用哪个模型
{
  name: "mafw_get_model_route",
  description: "Decide which LLM model to use based on task complexity and remaining budget.",
  parameters: {
    taskType: { type: "string", enum: ["planning", "coding", "reviewing", "trivial_edit"] },
    proceduralSuccessRate: { type: "number" }, // 0-1
    remainingTokenBudget: { type: "number" }
  }
}
// 返回: { model: "claude-3.5-haiku" | "claude-3.7-sonnet" | "o1-mini", reason: "..." }
// 规则：若 successRate > 0.9 && taskType=='coding' → Haiku (省钱)
```

### 4.3 冲突解决与回溯（新增）

```typescript
// 4. mafw_resolve_conflict — 处理并行 Wave 写冲突
{
  name: "mafw_resolve_conflict",
  description: "Resolve file conflicts using vector clock comparison.",
  parameters: {
    filePath: { type: "string" },
    incomingHash: { type: "string" },
    baseHash: { type: "string" }
  }
}
// 返回: { action: "merge" | "abort" | "notify_user" }
```

---

## 5. 上下文注入机制（v6.0 Token 预算动态分配器）

v5.0 的固定 128K 预算升级为 **动态水位线（Dynamic Watermark）**。

| 优先级 | 注入内容 | 预算占比 | 弹性策略 |
| :--- | :--- | :--- | :--- |
| **P0 (刚性)** | System Prompt + L3 锁定约束 | ≤ 3K | 不可压缩 |
| **P1 (高)** | 当前 Wave 任务 + 最近 1 次失败原因 | ≤ 5K | 不可压缩 |
| **P2 (中)** | 相关 T4 过程记忆 + 高能量事实 | ≤ 4K | 若 Token 吃紧，仅保留 Top 3 |
| **P3 (低)** | 历史 T2 叙事 | ≤ 2K | 若 Token 吃紧，用向量摘要替代 |

**新增逻辑**：若 `mafw_get_model_route` 返回轻量模型，自动将 P2/P3 预算压缩 50%，强行触发混合压缩器。

---

## 6. 文件与状态存储（v6.0 弹性并发）

### 6.1 目录结构（新增向量时钟与快照）

```
.mafw/
├── goals/
│   └── {goalId}.md           
├── waves/
│   └── {goalId}.json         
├── receipts/
│   └── {goalId}/
│       └── spiral-{N}/        # 命名由 loop 改为 spiral
│           ├── wave-{M}.json  
│           └── state.json     
├── reviews/
│   └── {goalId}/
│       └── spiral-{N}.md      
├── memory/
│   ├── tier1/...
│   ├── tier2/...
│   ├── tier3/...
│   ├── tier4/...
│   └── l3/...
├── snapshots/                 # 新增：Checkpoint 快照
│   └── {goalId}/
│       └── checkpoint-{waveId}.tar.gz
├── status.json                # 升级：包含向量时钟
└── dashboard/
    └── index.html
```

### 6.2 状态元数据示例（新增向量时钟 Vector Clock）

```json
// .mafw/status.json
{
  "goals": {
    "goal-xyz": {
      "currentSpiral": 3,
      "phase": "execute",
      "version": { 
        "gateway": 42, 
        "plan": 40, 
        "execute": 41 
      },
      "checkpoints": ["wave-1", "wave-3"],
      "cost": { 
        "used": 15000, 
        "budget": 100000, 
        "threshold": 0.8 
      },
      "userWeights": {
        "speed": 0.3,
        "quality": 0.5,
        "cost": 0.2
      }
    }
  }
}
```

### 6.3 冲突处理流程

1. Execute Agent 修改 `file-a.ts`，携带 `version.execute = 41`。
2. 若 Plan Agent 同时修改该文件，携带 `version.plan = 40`。
3. Gateway 检测到 Vector Clock 冲突 → 暂停执行 → 调用 `mafw_resolve_conflict`。
4. 若无法自动合并，触发 `mafw_ask_user` 寻求人工裁决。

---

## 7. Hook 与事件系统（新增“中断”与“成本”钩子）

| Hook 名称 | 触发时机 | 自动动作 |
| :--- | :--- | :--- |
| `user.intervene` | 用户在 Dashboard 手动编辑代码 | 冻结当前 Wave → 触发 Plan Agent 增量重算 |
| `cost.over_threshold` | 当前 Spiral 成本超过预算 80% | 强制调用 `mafw_get_model_route` 降级模型，并注入 L3 约束“压缩检索” |
| `loop.stuck` | 连续 2 次 Spiral 失败且原因相似 | 暂停执行，生成 `stuck_report.md`，发起 `mafw_ask_user` |

---

## 8. Dashboard v6.0（三大新视图）

| 视图 | v6.0 内容 |
| :--- | :--- |
| **对齐仪表盘** | 显示用户当前权重滑块（Speed/Quality/Cost）与当前 Spiral 得分的匹配度 |
| **成本火焰图** | 按 Tool / Wave / Model 维度拆解的 Token 燃烧瀑布图 |
| **干预时间线** | 展示用户每次手动纠偏的时间点，以及系统为此进行的增量重规划次数 |

---

## 9. 与 v5.0 的关键差异总结

| 维度 | v5.0 (Executor) | v6.0 (Aligned Platform) |
| :--- | :--- | :--- |
| **用户交互** | 输入 Goal，输出 PASS/FAIL | 实时反馈加权 + 主动 Ask User + 拖拽纠偏 |
| **模型调用** | 固定模型 | 基于任务成功率 + 剩余预算的**动态路由** |
| **记忆压缩** | 全量 LLM | **Diff 算法 + LLM 混合**（省钱 30%-50%） |
| **并发控制** | 文件锁（易冲突） | **向量时钟 + 乐观锁**（生产级可靠） |
| **失败处理** | 重试 Loop | **Checkpoint 回溯 + 防震荡暂停** |
| **成本感知** | 无 | **实时 Telemetry + 自动降级** |

---

## 10. 待决策事项（v6.0 明确落地）

针对 v5.0 遗留的 6 大问题，v6.0 给出明确路线：

| 问题 | v6.0 决策 |
| :--- | :--- |
| **1. 检索实现** | **BM25 词法 + 向量索引 (FAISS)**，通过 RRF 融合。冷启动时仅用 BM25，积累 10+ Loop 后开启向量。 |
| **2. 压缩策略** | **混合模式**：Diff 用 Myers 算法，语义用 LLM。且 LLM 压缩仅在 Energy > 0.6 的记忆上执行。 |
| **3. 隐私过滤** | `mafw_observe` 内置 **正则脱敏**（API Key, JWT, Password），默认开启。 |
| **4. 存储后端** | 文件系统 + **SQLite 缓存索引**（用于快速向量检索），主状态仍存文件（便于 Git 追溯）。 |
| **5. Graph 索引** | 构建 **Neo4j 轻量替代**（基于 JSON 的关系映射），仅存储 T3/T4 概念间的 `depends_on` / `conflicts_with` 关系，用于回溯分析。 |
| **6. 多 Agent 并发** | **Gateway 采用 Vector Clock**，同一 Goal 的并行 Wave 允许并发，检测到冲突时暂停并由 Review Agent 裁决。 |

---

## 11. 演进路线图（Roadmap）

基于工程性价比，建议按以下顺序落地 v6.0 特性：

| 阶段 | 里程碑 | 核心交付 | 预期收益 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **基础韧性** | 向量时钟 + 冲突解决 + Checkpoint 回溯 | 解决并发崩溃，提升系统可靠性 |
| **Phase 2** | **成本控制** | 混合压缩器 + 认知路由 + 经济看板 | 降低 30%-50% Token 开销 |
| **Phase 3** | **产品化** | 用户反馈加权 + `mafw_ask_user` + 对齐仪表盘 | 形成产品差异化，建立用户信任 |

---

**结语**：MAFW v6.0 已从“忠实的任务执行者”进化为“**懂得权衡、承认不确定性、主动寻求帮助并精打细算的工程合伙人**”。文档即日起可作为开发基线。
```