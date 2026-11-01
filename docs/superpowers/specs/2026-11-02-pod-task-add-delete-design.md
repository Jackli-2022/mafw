# Pod 任务板 v2：新增 / 删除计划任务（稳定 task id）

- 日期：2026-11-02
- 状态：已批准（用户选择「2：新增/删除任务，先做稳定 id」）
- 前置：`docs/superpowers/specs/2026-10-31-pod-task-plan-edit-design.md`（v1：标题 + 验收）

## 1. 问题

v1 只能改标题/验收，因为任务身份是**位置生成**的（`${wave.id}-t${i+1}`）：

- 删掉 `w1-t1` 后，原来的 `w1-t2` 变成位置 1 → `pod_tasks.sourceKey = wave:w1:task:0` 命中旧行，
  状态会错位到另一个任务上；
- 回执 / review rubric 都按 taskId 引用，位置漂移会让「已通过」绑到错任务。

新增/删除必须先有**稳定任务 id**。

## 2. 决定

| # | 决定 | 理由 |
|---|---|---|
| D1 | `waves.tasks[]` 增加 `taskId`（对象任务字段） | 一经分配永不变；legacy 任务在第一次结构编辑时补成当前位置 id（对已有投影是 no-op） |
| D2 | 计划完成时（plan 节点）自动补 id 并写回 `waves.json` | 新 goal 从第一天就是稳定 id，不需要等编辑 |
| D3 | `pod_tasks.source_key`：有 `taskId` 用 `wave:<wid>:task:<taskId>`，legacy 仍用 `wave:<wid>:task:<index>` | 不制造重复行；结构编辑时一次性迁移 legacy key |
| D4 | 删除 = 从 `waves.json` 移除 + 删 `pod_task` 行（手工任务只删行） | 历史回执文件保留，删除只影响当前轮计划 |
| D5 | 新增 = 追加到指定 wave（缺省最后一个 wave），id 取 `max(数字后缀)+1` | 不提供 wave 选择 UI（v2 默认追加），需要时再扩展 |
| D6 | 门与 v1 一致：终态 / 节点运行中 → 409；有 actor 时仅 Lead | 防止执行中计划漂移 |
| D7 | 删除是硬删除，但 UI 两步确认 | 不引入 `deleted` 状态（会污染 review 的 taskId 集） |
| D8 | 空 wave 保留 | 不改 wave 序号/编号语义 |

## 3. 接口

```
POST   /api/pods/:podId/tasks
  { plan: true, goalId, waveId?, title, acceptance?, actorSessionID? }

DELETE /api/pods/:podId/tasks/:taskId
  { actorSessionID? }

resp: { task } / { deleted: { goalId, externalTaskId } }
```

- `plan: true`（或带 `waveId`）走计划任务；否则仍是手工任务。
- 计划任务的 `goalId` 必填；`waveId` 缺省 → 最后一个 wave。

## 4. 迁移

1. plan 完成：`ensureWaveTaskIds` 补齐 `taskId`（= 当前位置 id），写回文件；已有投影零变化；
2. 第一次结构编辑（新增/删除）：
   - `ensureWaveTaskIds` 补齐；
   - `migrateLegacyTaskKeys` 把 `wave:<wid>:task:<index>` 改成 `wave:<wid>:task:<taskId>`（externalTaskId 不变）；
   - 再写盘 + 重新投影；
3. 新计划从第一天就带 id，无需迁移。

## 5. 非目标

- 重排任务 / 跨 wave 移动；
- 删除 wave；
- 编辑历史 / 软删除；
- Agent 侧（MCP）增删计划任务。

## 6. 验收

- 纯函数：补 id 幂等、新增 id 不复用、删除只移除目标、编辑保留 taskId。
- 服务：legacy 计划删任务后剩余任务状态不变 + sourceKey 迁移；新增投影为 pending；运行中 409。
- 路由：DELETE 与 `plan:true` 新增；Builder actor 403。
- 计划完成：`waves.json` 落盘带 `taskId`。
- 桌面：新建可选「手工 / 加入计划」；计划任务两步删除。
- 回归：gateway / desktop / SDK 全量 + 三端 typecheck + build。
