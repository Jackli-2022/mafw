基于你的明确要求，直接从 v6.4 演进到 v6.6，跳过 v6.5 的“全局完全解绑”方案。以下是 **MAFW v6.4 → v6.6 的完整架构演进对照**，重点突出变化、保留和新增。

---

## 📊 MAFW v6.4 → v6.6 架构演进总览

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         MAFW 记忆系统架构演进路径                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│   v6.4  (GoalId 绑定)                v6.6  (项目级绑定，无 GoalId)                  │
│   ┌──────────────────────┐          ┌──────────────────────┐                       │
│   │  记忆边界: GoalId    │   ──▶   │  记忆边界: 项目目录   │                       │
│   │  隔离粒度: 任务级    │          │  隔离粒度: 项目级    │                       │
│   │  目录结构: 多层嵌套  │          │  目录结构: 扁平化    │                       │
│   │  数据模型: 含 goalId │          │  数据模型: 无 goalId │                       │
│   │  L5: 跨项目共享     │          │  L5: 跨项目共享（不变）│                       │
│   └──────────────────────┘          └──────────────────────┘                       │
│                                                                                     │
│   核心变化:                                                                         │
│   • 移除所有 goalId 字段和子目录                                                    │
│   • 合并 T2/T3/T4 为单一 memories.json                                             │
│   • 检索自动限缩当前项目目录                                                        │
│   • 同项目所有 Goal 共享记忆                                                        │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**跳过的 v6.5**：全局完全解绑（所有项目共享记忆）—— 因安全性考虑被否决。

---

## 🏛️ v6.4 架构（回顾）

```
{projectDir}/.mafw/
├── memory/
│   ├── tier1/{goalId}/spiral-{N}.jsonl    ← 按 goalId 分片
│   ├── tier2/{goalId}.json                ← 含 goal_id 字段
│   ├── tier3/{goalId}.json                ← 含 goal_id 字段
│   ├── tier4/{goalId}.json                ← 含 goal_id 字段
│   ├── l5/                                ← 无 goalId（全局公理）
│   │   ├── heuristics.json
│   │   └── axioms.json
│   ├── .harmonic_index.json               ← 含 goal_id 字段
│   └── .cognitive_graph.json              ← 含 goal_id 字段
├── parametric/{goalId}.yaml
├── goals/{goalId}.json
└── state/{goalId}.json
```

**数据模型（含 goalId）**：
```json
{
  "id": "mem_001",
  "goal_id": "goal_payment",        // ← 强制绑定
  "memory_type": "semantic",
  "primary_abstraction": "...",
  "cue_anchors": [...],
  "memory_value": "...",
  "energy": 0.85
}
```

**检索**：`WHERE goal_id = 'goal_payment' OR goal_id IS NULL`（项目级 + L5）

---

## 🏛️ v6.6 架构（目标架构）

```
{projectDir}/.mafw/
├── memory/                          ← ★ 所有记忆扁平化（无 goalId 子目录）
│   ├── observations/                ← T1 原始观察（按天分片）
│   │   ├── 2026-07-08.jsonl
│   │   └── 2026-07-09.jsonl
│   │
│   ├── memories.json                ← ★ T2+T3+T4 合并（无 goalId）
│   │                                 ← 每条记录通过 type 区分
│   │
│   ├── .harmonic_index.json         ← ★ 无 goal_id 字段
│   └── .cognitive_graph.json        ← ★ 无 goal_id 字段
│
├── l5/                              ← L5 全局公理（保持不变）
│   ├── heuristics.json
│   └── axioms.json
│
├── parametric/                      ← 参数化记忆（无 goalId）
│   └── project.yaml
│
├── state/                           ← 运行状态（无 goalId）
│   └── current.json
│
├── requests/                        ← 外部触发
│
└── config.yaml                      ← 项目配置（含项目名、技术栈等）
```

---

## 📦 数据模型对比

| 字段 | v6.4 | v6.6 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | ✅ | ✅ | 不变 |
| `goal_id` | ✅ 必填 | ❌ **移除** | 核心变化 |
| `memory_type` | `episodic/semantic/procedural/global` | `episodic/semantic/procedural` | L5 独立存放，不再混入 |
| `primary_abstraction` | ✅ | ✅ | 不变 |
| `cue_anchors` | ✅ | ✅ | 不变 |
| `memory_value` | ✅ | ✅ | 不变 |
| `energy` | ✅ | ✅ | 不变 |
| `salience` | ✅ | ✅ | 不变 |
| `review_count` | ✅ | ✅ | 不变 |
| `last_reviewed` | ✅ | ✅ | 不变 |
| `associations` | ✅ | ✅ | 不变 |
| `created_at` / `updated_at` | ✅ | ✅ | 不变 |

**v6.6 数据模型示例**：
```json
{
  "id": "mem_001",
  "type": "semantic",
  "abstraction_level": 2,
  "primary_abstraction": "支付超时优化至10s",
  "cue_anchors": ["支付", "超时", "重试"],
  "memory_value": "将支付网关超时从3s调整至10s，并配置指数退避重试...",
  "salience": 1.3,
  "energy": 0.85,
  "review_count": 2,
  "last_reviewed": "2026-07-08",
  "associations": ["mem_007", "mem_023"],
  "created_at": "2026-07-05T10:00:00Z",
  "updated_at": "2026-07-08T14:20:00Z"
}
```

---

## 🔧 工具接口对比

| 工具 | v6.4 | v6.6 | 变化 |
| :--- | :--- | :--- | :--- |
| `mafw_search` | `query, goal_id(可选)` | `query, type(可选), limit` | 移除 goalId，检索自动限缩当前项目 |
| `mafw_write_memory` | `memoryValue, type, cueAnchors, goalId` | `memoryValue, type, cueAnchors` | 移除 goalId |
| `mafw_update_energy` | `memoryId, delta` | 不变 | — |
| `mafw_commit_heuristic` | `content, triggerContext` | 不变 | 写入 l5/，跨项目共享 |
| `mafw_get_memories` | `goal_id, limit` | `type(可选), limit` | 移除 goalId |

---

## 🧠 检索策略对比

| 维度 | v6.4 | v6.6 |
| :--- | :--- | :--- |
| **项目内检索** | `WHERE goal_id = current_goal` | **自动限缩当前项目目录**（物理隔离） |
| **全局检索** | `WHERE goal_id IS NULL`（L5） | **L5 独立读取**（跨项目共享） |
| **排序** | `energy × BM25` | 不变 |
| **联想扩展** | 同 goalId 内 | **同项目内所有记忆**（跨 Goal 联想） |

---

## 🚀 SessionStart 注入对比

| 注入内容 | v6.4 | v6.6 |
| :--- | :--- | :--- |
| 项目身份 | 从 `config.yaml` 读取 | 从 `config.yaml` 读取（不变） |
| 全局公理 | L5 Top 3 | L5 Top 3（不变） |
| 热记忆 | 当前 GoalId 的 Top 5 | **整个项目的 Top 5**（跨 Goal 共享） |
| Spiral 摘要 | 当前 GoalId 的最新 Spiral | **整个项目的最新 Spiral 摘要** |

**v6.6 SessionStart 注入示例**：
```xml
<mafw_session_context>
  <project_identity>
    Project: payment-service
    Stack: Node.js v20, Redis, PostgreSQL
  </project_identity>

  <global_axioms>
    1. [L5] 所有支付回调必须实现幂等性。
    2. [L5] 金额计算强制使用 Decimal 类型。
  </global_axioms>

  <project_hot_memories>
    1. [semantic|能量:0.92] 支付超时优化至10s（来自 Goal: 修复超时）
    2. [procedural|能量:0.88] 部署流程：build.sh → migrate（来自 Goal: 部署优化）
    3. [episodic|能量:0.85] 上一轮修复了支付超时 Bug（来自 Goal: 修复超时）
  </project_hot_memories>
</mafw_session_context>
```

---

## 🔄 压缩与蒸馏对比

| 机制 | v6.4 | v6.6 |
| :--- | :--- | :--- |
| 压缩触发 | 当前 GoalId 的 T1 满 50 条 | **整个项目**的 observations 满 50 条 |
| 蒸馏触发 | 同 GoalId 内相同主题 > 3 条 | **跨 Goal** 相同主题 > 3 条（多任务经验合并） |
| 写入位置 | tier2/tier3/tier4（含 goalId） | **memories.json（无 goalId）** |

**蒸馏升级示例**：
- v6.4：Goal A 的“支付超时”和 Goal B 的“支付超时”各自独立存储
- v6.6：跨 Goal 自动合并为一条更高阶的语义记忆，能量叠加

---

## 📊 L5 全局公理的作用

| 维度 | 说明 |
| :--- | :--- |
| 存放位置 | `l5/heuristics.json` 和 `l5/axioms.json` |
| 是否绑定项目 | **否**（跨所有项目共享） |
| 如何写入 | Review Agent 手动调用 `mafw_commit_heuristic`，或系统蒸馏器将高频流程上浮为 L5 |
| 如何注入 | SessionStart 时自动注入 Top 3 |
| 优先级 | L5 > 项目记忆（冲突时以 L5 为准） |

---

## 🧩 迁移路径（v6.4 → v6.6）

| 步骤 | 操作 | 影响 |
| :--- | :--- | :--- |
| 1 | 备份 `.mafw/memory` | 安全回滚 |
| 2 | 读取所有 tier2/tier3/tier4 的 JSON 文件 | 提取所有谐波单元 |
| 3 | 移除每条记录的 `goal_id` 字段 | 核心数据清理 |
| 4 | 合并到 `memory/memories.json` | 单文件存储 |
| 5 | 将 `tier1/{goalId}/` 下的 JSONL 移动到 `observations/` | 按时间重命名 |
| 6 | 删除空目录 `tier1/`、`tier2/`、`tier3/`、`tier4/` | 目录清理 |
| 7 | 重建 `.harmonic_index.json` | 扫描 `memories.json` |
| 8 | 重建 `.cognitive_graph.json` | 基于关联字段重建 |
| 9 | 更新工具实现 | 移除所有 goalId 相关代码 |
| 10 | 更新 SessionStart 逻辑 | 改为加载整个项目的热记忆 |

---

## ✅ 最终设计原则总结（v6.6）

| 原则 | 说明 |
| :--- | :--- |
| **项目隔离** | 不同项目的记忆完全物理隔离（独立目录） |
| **项目内共享** | 同一项目的所有 Goal 共享全部记忆 |
| **无 GoalId** | 移除所有 goal_id 字段和子目录 |
| **L5 独立** | 全局公理跨项目共享，但独立存放 |
| **统一存储** | 所有长期记忆合并到单一 `memories.json` |
| **物理隔离** | 检索自动限缩当前项目目录，不混杂其他项目 |

---

## 🎯 适用场景

| 场景 | v6.4 | v6.6 |
| :--- | :--- | :--- |
| 单 Goal 项目 | ✅ 可行 | ✅ 可行 |
| 多 Goal 项目（经验共享） | ❌ 隔离（无法共享） | ✅ **共享** |
| 多 Goal 项目（经验隔离） | ✅ 隔离 | ❌ 无法隔离 |
| 跨项目经验共享 | 需手动写入 L5 | 需手动写入 L5（不变） |

**结论**：v6.6 最适合**同一项目内多任务并行、需要积累共享知识**的场景，如持续维护的微服务项目。如果同一项目下存在需要完全隔离经验的子任务（如两个完全不同的业务模块），则需要考虑是否真的属于“同一项目”，或者重新引入 `goal_id` 作为可选标签而非强制绑定。

---

这份架构演进文档是否完整反映了你的需求？如果需要进一步细化某个模块（如迁移脚本、工具接口的伪代码），随时告诉我。