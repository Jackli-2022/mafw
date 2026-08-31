# RSI Design Review Summary

**日期**: 2026-08-30  
**状态**: 分析完成，待执行修正  
**基于**: 子代理评审报告（3 blockers + 11 majors + 10 minors）

## Executive Summary

### 评审结论
RSI 设计规格文档（Phase 1/2/3）**设计质量良好但未达实施就绪状态**。核心架构（观测层→策略层→源码层）清晰，数据模型合理，但存在 3 个必须在实施前解决的 blocker。

### 关键发现

#### ✅ 设计优势
1. **三支柱可观测性**（AHE 论文启发）：组件/经验/决策可观测性设计完善
2. **分层证据下钻**：outcome→lesson→trajectory 三层结构合理
3. **可证伪契约**：`declared_prediction` 设计为 RSI 提供科学验证基础
4. **权限隔离**：注册表与 triage 确认层对 evolver 不可写，符合安全原则

#### ⚠️ 需修正问题

**Blockers（3 个）**：
1. **B1**: 取消路径 outcome 接线缺失（`mafw_cancel_goal` 不触发归档）
2. **B2**: `state.sessions` 数据模型与 `goal_sessions` 表设计冲突（需明确分工）
3. **B3**: triage 激活链缺少 evolution 类型分发（Phase 2 接口未定义）

**Majors（11 个）**：
- M1: prompt 源文件漂移副本未清理
- M2: `policySnapshot` 快照时机错误（应在 goal 创建时）
- M3: 模型路由组件未标注"不在本期"
- M4: trajectory TTL 豁免逻辑缺失
- M5: `failure_signature` 缺少首个错误工具名
- M6: `evolution_proposals` 表缺少 `requires` 字段
- M7: `GoalWorktreeManager` 硬编码分支名/mergeBase
- M8: 验证窗口统计方法未定义
- M9: evolver cron guard 未隔离（全局锁）
- M10: 回滚状态机不完整
- M11: `recordOutcome` 调用时机错误（在归档内部）

---

## 详细分析文档

### 1. [完整修正行动计划](2026-08-27-rsi-review-corrections.md)
- 所有 24 个问题的详细分析
- 每个问题的修复方案
- 影响文件清单
- 实施顺序建议

### 2. [快速修复指南](2026-08-27-rsi-quick-fixes.md)
- 6 个最关键问题的代码级修复方案
- 可直接复制粘贴的代码片段
- 测试验证清单
- 预估工时：7 小时

---

## 当前实现状态

### ✅ 已正确实现
1. `goal_outcomes` 表结构（gateway-db.ts:174）
2. `goal_sessions` 表结构（gateway-db.ts:196）
3. `evolution_proposals` 表结构（gateway-db.ts:206，含 `requires` 字段）
4. `recordGoalOutcome` 聚合逻辑（outcome-recorder.ts:82）
5. `getActivePolicy` 读取逻辑（policy.ts:16）
6. 注册表基础结构（registry.ts）
7. **取消路径 outcome 接线**（已修复 - 2026-08-30）
8. **policySnapshot 快照时机**（已修复 - 2026-08-30）
9. **failure_signature 工具名**（已修复 - 2026-08-30）
10. **trajectory prune 豁免**（已实现）

### ❌ 需修正（Phase 2）
1. **GoalWorktreeManager 泛化**：支持 `evolve/{proposalId}` 分支
2. **验证窗口统计方法**：定义具体统计检验方法
3. **evolver cron guard 隔离**：实现 per-action 独立锁
4. **回滚状态机**：实现完整回滚流程

---

## 实施建议

### 立即行动（今日）
1. **B1**: 修复取消路径 outcome 接线（1 小时）
2. **B2**: 验证 state.sessions 数据模型兼容性（1 小时）
3. **B3**: 更新 Phase 2 设计文档，明确 triage 分发接口（0.5 小时）

### 本周完成
4. **M2**: 实现 `policySnapshot` 写入（1 小时）
5. **M11**: 重构 `recordOutcome` 调用时机（2 小时）
6. **M5**: 完善 `failure_signature` 实现（2 小时）
7. **M6**: ALTER TABLE 添加 `requires` 字段（0.5 小时）
8. **M1**: 删除漂移副本 + 注册表验证（1 小时）

### Phase 2 准备（下周）
9. **M7**: 泛化 `GoalWorktreeManager`（3 小时）
10. **M8**: 补充验证窗口统计方法文档（1 小时）
11. **M9**: 实现 per-action guard（2 小时）
12. **M10**: 实现回滚状态机（3 小时）

---

## 验证清单

Phase 1 实施完成后，需验证：

- [ ] 取消路径触发 `recordGoalOutcome`（verdict='CANCELLED', failure_kind='user_cancel'）
- [ ] `onGoalCreated` 写入 `policySnapshot` 到 StateFile
- [ ] `recordGoalOutcome` 从 `goal_sessions` 表读取 session 列表
- [ ] `failure_signature` 包含首个错误工具名
- [ ] `evolution_proposals` 表有 `requires` 字段
- [ ] trajectory prune 豁免已登记 session
- [ ] 所有测试通过（`npm test -- --runInBand --forceExit`）

---

## 风险评估

### 高风险（Blockers）
- **B1**: 取消的 goal 永远无 outcome 数据，影响 RSI 闭环完整性
- **B2**: 数据模型冲突可能导致 trajectory 聚合失败
- **B3**: Phase 2 triage 分发未定义，阻碍策略演化

### 中风险（Majors）
- **M2**: 快照时机错误导致策略版本错标
- **M11**: 归档失败时 outcome 丢失
- **M5**: 失败签名缺少关键信息，影响 evolver 归因

### 低风险（Minors）
- 多数为文档/注释/编码问题，不影响核心功能

---

## 下一步

1. **确认优先级**：是否先执行 B1（取消路径修复）？
2. **分配资源**：7 小时关键修复，谁负责？
3. **时间表**：本周内完成所有 Blockers + Majors？
4. **Phase 2 启动**：Blockers 解除后，是否立即启动 Phase 2 设计细化？

需要我开始执行具体的修复工作吗？