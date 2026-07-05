# MAFW Agent 规范 v6.4

## 1. 架构原则

- Interview 后全自动：用户只确认 Goal Charter，之后零干预
- Ralph Loop 迭代：Plan → Execute → Review → 自动重试直到完成
- Wave 并行：Wave 内 Task 并行，Wave 间串行
- 磁盘记忆：所有状态写进仓库，Agent 会忘，repo 不会
- 成本感知：Cognitive Router 根据预算自动降级模型，CostEstimator 追踪每次调用
- 用户对齐：mafw_ask_user 非阻塞提问，mafw_record_feedback 修正记忆能量
- 记忆生长：显著度保护、联想网络、间隔复习、抽象蒸馏（v6.4）
- 零 LLM 依赖：所有认知引擎纯规则驱动

## 2. Agent 定义

### 2.1 Goal Agent
- 职责：Interview 阶段，追问确立目标/指标/边界
- 输出：Goal Charter（goals/{id}.md）
- 交互：用户确认前唯一可交互点

### 2.2 Plan Agent
- 职责：拆解 Task，划分 Wave
- 输入：Goal Charter + L2 Lessons + L3 Δ + L1 Wave Digest
- 输出：waves.json + tasks/{id}.md

### 2.3 Execute Agent
- 职责：编写代码，生成 Receipt
- 输入：Task 定义 + L3 Constraint Δ + L3 Prompt Δ
- 输出：代码变更 + Receipt

### 2.4 Reviewer
- 职责：审查代码，输出 Review 报告
- 输入：Goal Charter + Task 定义 + Receipt + Diff + L3 Constraint Δ
- 输出：Review 报告（verdict / metrics_check / boundary_check / code_quality / critical_issues / warnings / suggestions / handoff_suggestion / delta_compliance）

### 2.5 Memory Extractor Agent
- 职责：从 Review 失败中提取参数化记忆（Δ）
- 输入：L2 YAML Lesson + Review 报告 + AGENTS.md
- 输出：0~2 个 Δ yaml

### 2.6 Cognitive Router（v6.0）
- 职责：Agent 级别动态模型选择
- 输入：剩余 Token 预算、总预算、Agent 类型
- 输出：`{ model: string, reason: string }`
- 规则：`usage > 80% && agentType === 'execute'` → 切换 Haiku

### 2.7 Cost Accountant（v6.0）
- 职责：记录每次 Tool 调用的估算 Token/成本
- 输入：`ToolCallRecord { goalId, loopNum, toolName, input }`
- 输出：`CostRecord` 持久化到 `cost_logs` 表 + JSON 文件

### 2.8 Alignment Agent（v6.0）
- 职责：追踪用户反馈，更新记忆能量
- 输入：`FeedbackInput { targetId, type, goalId }`
- 输出：`FeedbackOutput { energyDelta }`
- 规则：thumbs_up → +0.2, thumbs_down → -0.1

### 2.9 Salience Perceptor（v6.4 新增）
- 职责：自动识别观察内容的显著度
- 输入：原始观察文本
- 输出：salience 值 (0.5 / 1.0 / 1.5)
- 规则：故障/错误 → 1.5，常规日志 → 0.5，默认 → 1.0
- 影响：高显著度记忆衰减慢 3 倍

### 2.10 Review Scheduler（v6.4 新增）
- 职责：后台调度记忆复习任务
- 算法：艾宾浩斯曲线 `1 * 2^reviewCount` 天
- 输出：复习队列 `memory/.review_queue.json`

### 2.11 Abstraction Distiller（v6.4 新增）
- 职责：从重复记忆中提炼更高层次知识
- 规则一：≥3 条相似 T2 叙事 → 合并为 1 条 T3 事实
- 规则二：≥5 次成功 T4 流程 → 上升为 L5 全局启发式

## 3. 谐波记忆系统（v6.3）

### 3.1 数据模型

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  goal_id: string | null;
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;    // 6-8 词核心摘要
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // v6.4: 0.5~1.5
  abstraction_level?: number;     // v6.4: 0=T1, 1=T2, 2=T3/T4, 3=L5
  review_count?: number;          // v6.4: 复习次数
  last_reviewed?: string;         // v6.4: 上次复习
  top_associations?: string[];    // v6.4: 联想预取
  merged_from?: string[];
  created_at: string;
  updated_at: string;
}
```

### 3.2 检索

检索完全无视层级，只查 `primary_abstraction` + `cue_anchors`：
```
查询 → BM25 扫描 .harmonic_index.json（无视 memory_type）
     → 按 energy × BM25 排序
     → 按需从 tier 文件加载完整 memory_value
     → 联想预取 top_associations
```

### 3.3 压缩

`HybridCompressor.compress()` 输出 `HarmonicUnit` 并自动：
1. 计算显著度
2. 写入对应 tier 文件
3. 更新 `.harmonic_index.json`
4. 触发 MinHash 跨层合并检查

## 4. Tools 清单（v6.4 总共 8 个）

| Tool | 用途 |
|---|---|
| `mafw_search_hybrid` | BM25 + RRF 谐波检索 + 联想预取 |
| `mafw_get_deltas` | 获取参数化约束（L3） |
| `mafw_update_state` | 更新状态文件 |
| `mafw_load_state` | 读取状态文件 |
| `mafw_ask_user` | 非阻塞向用户提问 |
| `mafw_record_feedback` | 记录用户点赞/点踩 |
| `mafw_get_model_route` | 动态模型选择（基于预算） |

## 5. 关键规范

### 5.1 加密算法
所有生产环境的认证系统必须使用 RS256 非对称加密算法。

### 5.2 测试覆盖率
测试覆盖率低于 80% 的代码必须标记为 DEGRADED，除非 Task 标签包含 "prototype" 或 "spike"。

### 5.3 边界测试
每个功能必须有边界测试（空值、超长输入、特殊字符、时序攻击）。
