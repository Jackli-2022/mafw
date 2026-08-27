# Goal 编排 RSI — Phase 3：源码结构进化设计

日期：2026-08-27（v2，按子代理评审修正）
状态：待审阅
依赖：Phase 2 已运转（策略层演化闭环稳定，declared_prediction 验证机制可信）

## 1. 目标

编排的**结构**（LangGraph 图的节点/边、波次划分逻辑、归档/恢复流程）进入可演化范围：变更以源码 diff 表达，在隔离 worktree 中修改，经分层门禁验证，triage 人确认后由 self-update 接力重启生效。

与 Phase 2 的边界：Phase 2 改"注册表内的参数与 prompt"（数据层，即时生效）；Phase 3 改"图结构与执行逻辑"（源码层，重启生效）。

## 2. 前提条件（评审核实后新增）

- **仅限源码安装形态**：结构演化要求 gateway 以源码 checkout 运行（`gateway/src` 存在——self-update.ts 现有同款判断）。npm 全局安装形态下无 git 仓库可 worktree，结构演化功能显式禁用（API 返回明确错误，不静默降级）
- **主分支名自适应**：本仓库主分支是 `master` 而非 main（现有 GoalWorktreeManager 硬编码 `checkout('main')`，连现有 goal 归档都会失败——见 §3.1 泛化要求）

## 3. 分层验证门禁（self-update 门禁升级）

| 层 | 内容 | 现状/细节 |
|---|---|---|
| L0 | `npm run build` 编译通过 + dist 校验 | ✅ self-update 已有（5min 超时） |
| L1 | `npm test` 全量 | ✅ 套件存在，**接入 self-update**：命令 `npm test -- --runInBand --forceExit`（kernel 集成套件需要），超时预算 10min；build 过但 test 失败 → 不重启，pending-restart 令牌标记失败原因供调用者续跑诊断 |
| L2 | smoke goal：合成最小 goal 端到端跑通 plan→execute→review→archive，断言 outcome 行落库 | ❌ 新建，在**提议阶段**于 worktree 内执行（不进 self-update 关键路径，避免拉长重启窗口） |
| L3 | goal 回放 benchmark | ❌ 远期，见 §6 |

## 4. 结构演化流程

### 4.1 worktree 管理器泛化（评审 M7：现有 GoalWorktreeManager 不能直接用）

`goal-worktree-manager.ts` 需先泛化才能复用：
- 分支名参数化（现状硬编码 `goal/{goalId}` → 支持 `evolve/{proposal-id}`）
- mergeBase/checkout 目标参数化（现状硬编码 `main` → 探测实际默认分支，master/main 自适应）
- 清理策略参数化：现状 archive 成功即删分支；结构演化要求**失败分支保留**（见 §4.2）

### 4.2 流程

```
触发（两个来源）
  ├─ evolver 识别到注册表内无法表达的改进 → proposal（requires='structural'）
  └─ 人/agent 直接发起
        │
        ▼
worktree 变体（泛化后的 GoalWorktreeManager）
  ├─ 从默认分支切 evolve/<proposal-id>
  ├─ agent 在 worktree 内修改源码
  ├─ diff 路径保护检查（§5）→ 触碰保护清单即终止
  ├─ 门禁 L0+L1+L2 在 worktree 内执行
  │     └─ 失败 → 分支保留（不删），失败原因写 proposal.validation_result
  ▼
triage 确认（evolution 类 item，人审源码 diff + 门禁报告）
  ├─ 拒绝 → 分支保留，proposal → rejected
  └─ 确认 → merge 到默认分支
        │
        ▼
self-update 接力重启（现有机制，pending-restart.json 的 commit 字段记 proposal-id）
        │
        ▼
记忆融合（复用 mafw_merge_memory / archive-worktree）
  └─ worktree 内的教训/决策融合回主记忆库——失败分支的知识也带回（"此路不通及原因"）
```

关键设计：

- **失败分支保留不删**：DGM 式 stepping stones；分支命名规范 `evolve/<proposal-id>` 使档案可枚举
- **declared_prediction 对照沿用 Phase 2 机制**（同一 evolution_proposals 表，`requires='structural'`，Phase 1 建表已预留该列）
- **回滚**：`git revert <merge-commit>` + 再走一遍 self-update 接力（重启 ~2-3s）
- **归档接线点**：真实公共漏斗是 index.ts 的 archiveGoal（内联 lambda 注入节点），`archive.node.ts` 仅 re-export；`chat/graph-runner.ts` 的 stub buildNodeOptions 不在演化面内（评审 m10）

## 5. 保护清单（循环外，diff 路径检查物理执行，glob 级枚举）

触碰以下任一路径的提议在门禁 L2 前直接拒绝：

- `gateway/src/orchestration/registry.ts`（注册表本体）
- `gateway/src/orchestration/validator.ts`、`evolver.ts`（校验与提议逻辑）
- `gateway/src/self-update.ts`、`gateway/src/core/auth.ts`
- `gateway/src/mcp/handlers/**` 中 triage 相关 handler、`index.ts` 内联 triage 路由（按函数级注释锚点识别，文件级过粗时以 glob + 人工复核兜底）
- `package.json`、`gateway/package.json`（依赖声明变更只能人工）

## 6. L3 回放 benchmark（远期，本期不实施）

形态参考 LoopsBench（arXiv:2608.00267）与 LongMemEval runner 模式：

- 从 goal_outcomes + 归档 goal charter 抽 N 个代表性场景（成功/失败各半）冻结为用例集 `evaluation/goal-replay/`
- 回放限定**确定性可比切片**：plan 输出的 waves 依赖正确性、review 判定与人工标注一致性
- 不回放 execute（副作用大、环境不可复现）；execute 质量由 L2 smoke goal + 在线 outcome 覆盖
- runner 直接 import gateway 类 + 临时目录隔离（同 LongMemEval），不污染真实数据

## 7. 测试

- diff 路径保护：触碰保护清单任一 glob 的提议被拒绝
- worktree 泛化：master/main 自适应、evolve/* 分支命名、失败保留/成功清理两种策略
- self-update L1：test 失败不重启 + 令牌失败原因记录；超时预算生效
- smoke goal：合成 goal 全链路断言（waves.json 生成、review 报告、outcome 落库）
- 回滚：revert + 接力重启编排正确性
- 前提检查：npm 全局安装形态下结构演化 API 显式报错

## 8. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/self-update.ts` | update 流程接 L1（npm test，10min 预算，失败不重启+原因记录） |
| `gateway/src/core/engine/goal-worktree-manager.ts` | 泛化：分支名/mergeBase/清理策略参数化，master/main 自适应 |
| `gateway/src/orchestration/structural.ts` | 新建：worktree 变体编排 + diff 路径保护 + 门禁执行 ~220 行 |
| `gateway/src/orchestration/smoke-goal.ts` | 新建：L2 合成 goal 端到端断言 ~150 行 |
| `gateway/src/orchestration/evolver.ts` | 结构类提议出口（requires='structural'） |
| `tests/unit/gateway/` | +4 个测试文件 |
| `evaluation/goal-replay/` | 远期占位 README |
| `AGENTS.md` | 增补结构演化流程与保护清单 |

## 9. Phase 3 退出标准

- 一次完整结构演化走通：提议 → worktree 修改 → 路径保护 + 门禁 → triage → merge → 接力重启 → 后续 outcome 对照 declared_prediction
- 一次被拒/失败变体的分支与知识保留可查证（分支在、fusion-log 有记录）
