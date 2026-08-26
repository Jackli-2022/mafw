# Goal 编排 RSI — Phase 3：源码结构进化设计

日期：2026-08-27
状态：待审阅
依赖：Phase 2 已运转（策略层演化闭环稳定，declared_prediction 验证机制可信）

## 1. 目标

编排的**结构**（LangGraph 图的节点/边、波次划分逻辑、归档/恢复流程）进入可演化范围：变更以源码 diff 表达，在隔离 worktree 中修改，经分层门禁验证，triage 人确认后由 self-update 接力重启生效。

与 Phase 2 的边界：Phase 2 改"注册表内的参数与 prompt"（数据层，即时生效）；Phase 3 改"图结构与执行逻辑"（源码层，重启生效）。**注册表、evolver 校验器、triage 流、auth/权限、self-update 本体永不在演化范围内。**

## 2. 分层验证门禁（self-update 门禁升级）

结构变更的验证按成本从低到高分四层，任一失败即终止：

| 层 | 内容 | 现状 |
|---|---|---|
| L0 | `npm run build` 编译通过 + dist 校验 | ✅ self-update 已有（5min 超时） |
| L1 | `npm test`（tests/unit/gateway 全量） | ✅ 套件存在，**需接入 self-update 流程** |
| L2 | smoke goal：合成最小 goal 端到端跑通 plan→execute→review→archive，断言 outcome 行落库 | ❌ 新建 |
| L3 | goal 回放 benchmark（历史 goal 场景重放对比） | ❌ 远期，见 §5 |

self-update.ts 变更：`action: update` 流程在 build 后插入 L1（`npm test`，exit≠0 则不重启）；L2 由结构演化流程在**提议阶段**于 worktree 内执行（见 §3），不进 self-update 关键路径（避免重启窗口被拉长）。

### 2.1 L1 接入细节

- **超时预算**：`npm test` 超时 10min（现有 build 5min + test 10min = 15min 总预算；policy.yaml `selfUpdate.testTimeout` 可调）
- **kernel 测试特殊处理**：`tests/unit/gateway/kernel*.test.ts` 需 `--runInBand --forceExit`（真实 ipykernel + zeromq handle 残留），单独 spawn 一次 `jest --runInBand --forceExit --testPathPattern=kernel`
- **中间态语义**：build 通过但 test 失败 → 不重启，proposal.validation_result 记录 `{ stage: 'L1', error: 'test failed', exitCode }`，分支保留不删；build 失败 → 不进入 L1，直接记录 L0 失败

## 3. 结构演化流程

### 3.1 前提约束

**仅源码安装形态可用**：gateway 以 npm 全局安装运行时没有 git 仓库可 worktree（`self-update.ts:122-123` 以 `gateway/src` 存在与否判断源码 checkout）。结构演化流程在检测到非源码安装时直接跳过并记录 warn。

### 3.2 Worktree 编排（泛化 goal-worktree-manager）

现有 `goal-worktree-manager` 硬编码了 `goal/{goalId}` 分支名和 `checkout('main')` 归档（本仓库主分支是 master），不满足演化需求。新建 `evolution-worktree-manager`：

- **参数化**：`branchPrefix`（默认 `evolve/`）、`mergeBase`（默认 `master`，自动检测）、`cleanupOnSuccess`（默认 true）、`cleanupOnFailure`（默认 false——保留 stepping stones）
- **archive 泛化**：成功时 merge + delete branch（可配置）；失败时仅保留分支不操作
- **复用策略**：不直接复用 goal-worktree-manager，而是抽取公共 worktree 操作到 `worktree-utils.ts`，两者各自调用

```
触发（两个来源）
  ├─ evolver 识别到注册表内无法表达的改进（如"需要新增节点"）→ proposal 标记 requires: 'structural'
  └─ 人/agent 直接发起
        │
        ▼
worktree 变体（evolution-worktree-manager）
  ├─ 从 master 切分支 evolve/<proposal-id>
  ├─ agent 在 worktree 内修改源码
  ├─ 门禁 L0+L1+L2 在 worktree 内执行
  │     └─ 失败 → 分支保留（不删），失败原因写入 proposal.validation_result
  ▼
triage 确认（人审源码 diff + 门禁报告）
  ├─ 拒绝 → 分支保留，proposal → rejected
  └─ 确认 → merge 到 master
        │
        ▼
self-update 接力重启（现有机制，复用 pending-restart.json）
  ├─ commit 字段记录 proposal-id
  └─ 重启后向发起会话注入完成通知（现有）
        │
        ▼
记忆融合（复用 mafw_merge_memory）
  └─ worktree 内产生的教训/决策融合回主记忆库（现有 archive-worktree 流程）
```

### 3.3 关键设计

- **失败分支保留不删**：DGM 式 stepping stones——失败的结构变体是后续演化的知识（"此路不通及原因"），由记忆融合带回
- **结构变更的 declared_prediction 对照沿用 Phase 2 机制**（同一 evolution_proposals 表，`requires: 'structural'` 标记区分）
- **回滚**：`git revert <merge-commit>` + 再走一遍 self-update 接力（重启 ~2-3s，已有机制）

## 4. 保护约束（循环外清单）

源码级硬编码保护，演化提议触碰以下路径即物理拒绝（在门禁 L2 前做 diff 路径检查）：

**精确文件列表**：
- `gateway/src/orchestration/registry.ts`（注册表本体）
- `gateway/src/orchestration/validator.ts`（验证逻辑）
- `gateway/src/orchestration/evolver.ts`（校验逻辑部分）
- `gateway/src/orchestration/triage-evolution.ts`（triage confirm handler）
- `gateway/src/self-update.ts`
- `gateway/src/core/auth.ts`

**glob 模式**：
- `gateway/src/mcp/handlers/*triage*`（triage 相关 handler）
- `gateway/src/index.ts` 中 triage confirm 路由（内联，需 grep `triage.*confirm` 定位）

**额外约束**：
- `package.json` 的依赖声明（防止引入未审查依赖；如需依赖变更只能人工）
- `gateway/src/config.ts` 的保护清单配置本身（防演化扩大自己的可写范围）

## 5. L3 回放 benchmark（远期，本期不实施）

形态参考 LoopsBench（arXiv:2608.00267）与 LongMemEval 的 runner 模式：

- 从 goal_outcomes + 归档 goal charter 抽取 N 个代表性场景（含成功/失败各半），冻结为用例集 `evaluation/goal-replay/`
- 回放内容限定为**确定性可比的切片**：plan 节点输出质量（waves 划分的依赖正确性）、review 节点判定与人工标注的一致性
- 不回放 execute（副作用大、环境不可复现）；execute 的质量由 L2 smoke goal + 在线 outcome 信号覆盖
- runner 直接 import gateway 类 + 临时目录隔离（同 LongMemEval），不污染真实数据

## 6. 测试

- diff 路径保护：触碰保护清单的提议被门禁拒绝
- worktree 门禁：L0/L1/L2 各失败分支的行为（分支保留、validation_result 记录）
- self-update L1 接入：test 失败不重启
- smoke goal：合成 goal 全链路断言（waves.json 生成、review 报告、outcome 落库）
- 回滚流程：revert + 接力重启的编排正确性

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/self-update.ts` | update 流程接入 L1（npm test 门禁 + kernel 特殊处理 + 超时预算） |
| `gateway/src/orchestration/evolution-worktree-manager.ts` | 新建：泛化 worktree 编排（参数化 branch/merge/cleanup）~120 行 |
| `gateway/src/orchestration/worktree-utils.ts` | 新建：公共 worktree 操作（供 goal-worktree-manager 和 evolution-worktree-manager 复用）~80 行 |
| `gateway/src/orchestration/structural.ts` | 新建：diff 路径保护 + 门禁执行 ~150 行 |
| `gateway/src/orchestration/smoke-goal.ts` | 新建：L2 合成 goal 端到端断言 ~150 行 |
| `gateway/src/orchestration/evolver.ts` | 结构类提议出口（requires: 'structural'） |
| `gateway/src/orchestration/registry.ts` | 增补保护清单 glob 模式 |
| `tests/unit/gateway/` | +4 个测试文件（含 worktree manager） |
| `evaluation/goal-replay/` | 远期，本期仅占位 README 说明形态 |
| `AGENTS.md` | 增补结构演化流程与保护清单（精确文件 + glob） |

## 8. Phase 3 退出标准

- 一次完整的结构演化走通：提议 → worktree 修改 → 门禁 → triage → merge → 接力重启 → 后续 outcome 对照 declared_prediction
- 一次被拒/失败变体的分支与知识保留可查证（fusion-log 有记录）
