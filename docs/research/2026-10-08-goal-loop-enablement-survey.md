# Goal/Loop 编排启用调研（2026-10-08）

> 调研任务：正式启用 goal/loop 编排并让 agent 自治编排。纯调研，未改代码。
> 方法论：research 子代理全量代码走查 + 父会话记忆检索交叉验证。

## 结论速览

goal 编排当前是「装配完成、未接线」状态：无 feature flag，但**缺 starter**——goal 可被创建，创建后没有任何东西启动执行。agent 自治编排目前只具备「创建」和「取消」两个动词，「推进」链路断裂。纯 config 无法启用，最小启用需 5 个小改动（见 §5）。

## 1. 状态机链路现状

- 四条创建入口（`mafw_create_goal` / `mafw_set_goal` / 插件 `/goal` / automation triage）全部只写 request 文件，不启动执行
- 唯一执行入口 `handleValidate`（`gateway/src/index.ts:6161`）→ `onGoalCreated`（`index.ts:6408`）→ langgraph invoke；**当前无生产调用方**
- 节点驱动：plan（`plan.node.ts:23`）/ execute、review（`node-runner.ts:75-118`）建裸 session + `promptAsync('/skill mafw-* {goalId}')`——`/skill` 是裸文本不是真命令，opencode 里无对应物；无模型路由
- 路由：`core/langgraph/graph.ts:4-15`（PASS→归档 / FAIL→回 plan / maxRounds=3→归档 / pendingQuestion→askUser）

## 2. 致命断点（按严重度）

1. **触发链断**：`/api/work/validate` 无人调用；`mafw_set_goal` 写 `~/.mafw`（数据根，非注册项目），`goal_created` 监听器找不到 state 直接返回（`index.ts:2541` + `findGoalStatePath` 只扫注册项目）
2. **plan 竞态**：`plan.node.ts:41-44` fire-and-forget promptAsync 后立即查 `waves.json` → 必然不存在 → verdict ERROR → 直接 archive_fail
3. **FileCheckpointer 不完整**：`putWrites` no-op（`checkpointer.ts:160`），interrupt/resume 协议不成立，`invoke(null)` 会从 `__start__` 重跑 plan（重复建 session）
4. **askUser 链路断**：`asked` 事件全库无写入点 → respond 恒 404；`mafw_list_pending_questions` 永远空
5. **字段错配**：sync 写 `loop`、`mafw_get_goal_status` 读 `round` → 永远 undefined
6. **execute/review 的 interrupt 恢复**依赖 `POST /api/work/{goalId}/complete`，无调用方

## 3. agent 自治现状

| 动词 | 状态 |
|---|---|
| 创建 goal | ✅ manager agent 白名单含全部 goal 工具，identity 提示词已教（charter 五段式、复述确认） |
| 推进 goal | ❌ 断（断点 1/2/6） |
| 取消 goal | ✅ `mafw_cancel_goal` → `/control` ABORT → CANCELLED 归档链路完整 |
| 观测 goal | ✅ `<goal-snapshot>` 每轮注入 + milestone push + BudgetGuard 已接线 |

## 4. 遗留

- 死代码：`chat/graph-runner.ts`、`core/plugin.ts`（929 行 legacy）、`core/mcp/tools.ts`、`poll.ts`
- spec 评审遗留：phase3 M12 `GoalWorktreeManager` 硬编码 main（主分支是 master）
- Phase 2/3（策略包/源码演化）未实现，`evolution_proposals` 表无写入路径
- automation `createGoal` 写 `nextAction:'START'` 不在 langgraph 路由词汇表

## 5. 最小启用改动清单

**小改动**（估计可在一到两个会话内完成）：

1. **统一目录 + 接 starter**：goal 写入目标项目 `.mafw`（带 projectDir），写完 loopback `POST /api/work/validate`（先例：`manager-cancel-goal.ts` 的 loopback HTTP）
2. **修 plan 竞态 + 事件驱动 phase 完成**：订阅 runtime 事件流，goal session `session.idle` + 产物文件出现 → 自动推进（消灭「agent 须自觉调 complete」依赖，自治闭环关键）
3. **修 askUser 落地**：node 写 `QuestionLedger asked` 事件 + pendingQuestion 落 state → manager 可经 `mafw_list_pending_questions`/`mafw_answer_question` 自治代答
4. **FileCheckpointer 二选一**：补齐协议，或显式改「节点幂等重入 + state 文件驱动」
5. **修字段错配**（loop/round、maxRounds 边界）

**大改动**：

6. skill 执行模型替换：`/skill mafw-*` 改为真 agent definition（`agents.install` 参照 manager）或直接把 prompt 模板发给工作会话
7. 多 goal 并发 / worktree 隔离 / RSI Phase 2/3——明确不属于启用最小集

## 启用检查清单

- [ ] goal 写入目标项目 `.mafw`，goal_created 后 state 出现 `GRAPH_INVOKED`
- [ ] plan session 的 prompt 可被执行（非 `/skill` 裸文本）
- [ ] waves.json 产出后图推进 execute（产物等待有超时与失败归档）
- [ ] execute→review 由事件驱动（session.idle + 产物校验）
- [ ] review verdict 正确路由三分支
- [ ] askUser 问答全链路（列出→回答→图恢复）
- [ ] status/snapshot/dashboard 的 round/phase/verdict 一致
- [ ] archive 全链路（session 清理 + outcome + milestone + goal reward）
- [ ] cancel 全程可用
- [ ] BudgetGuard 按 policySnapshot 挂载三类 session
- [ ] 重启恢复语义明确（重跑或续跑，无重复 plan session）
- [ ] 合成最小 goal 端到端冒烟 plan→execute→review→archive
- [ ] 清理或标注死代码（GraphRunner / core/plugin.ts / core/mcp/tools.ts / poll.ts）
