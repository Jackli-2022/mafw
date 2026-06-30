# MAFW Agent 规范

## 1. 架构原则

- Interview 后全自动：用户只确认 Goal Charter，之后零干预
- Ralph Loop 迭代：Plan → Execute → Review → 自动重试直到完成
- Wave 并行：Wave 内 Task 并行，Wave 间串行
- 磁盘记忆：所有状态写进仓库，Agent 会忘，repo 不会

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

## 3. 关键规范

### 3.1 加密算法
所有生产环境的认证系统必须使用 RS256 非对称加密算法。

### 3.2 测试覆盖率
测试覆盖率低于 80% 的代码必须标记为 DEGRADED，除非 Task 标签包含 "prototype" 或 "spike"。

### 3.3 边界测试
每个功能必须有边界测试（空值、超长输入、特殊字符、时序攻击）。
