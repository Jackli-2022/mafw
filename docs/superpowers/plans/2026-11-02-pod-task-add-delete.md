# Pod 任务板 v2（新增 / 删除）— 实施计划

- 日期：2026-11-02
- 设计：`docs/superpowers/specs/2026-11-02-pod-task-add-delete-design.md`
- 方式：TDD；每 Task 一次 commit

## Task 1 — 纯函数：稳定 id / 新增 / 删除

文件：`gateway/src/core/goal/wave-plan-edit.ts` + `gateway/tests/unit/goal/wave-plan-edit.test.ts`

- `taskIdAt(wave, task, index)`：显式 `taskId` 优先，回退位置 id
- `ensureWaveTaskIds(plan)`：补 id（幂等），报告 changed
- `editWaveTask` 保留 `taskId` 与未知字段
- `addWaveTask(plan, waveId|null, {title, acceptance?})`：追加 + 不复用已删 id
- `deleteWaveTask(plan, externalTaskId)`：只删目标，空 wave 保留

## Task 2 — 计划完成时补 id

文件：`gateway/src/core/goal/driver.ts` + `goal-driver-completion.test.ts`

- plan 产物落盘后 `ensureWaveTaskIds` + 写回
- 测试：字符串任务 → `{title, taskId}`；对象任务保留 acceptance

## Task 3 — 服务层 add/delete + legacy key 迁移

文件：`gateway/src/core/pod/pod-task-service.ts`、`pod-store.ts` + 测试

- `projectWaves`：`externalTaskId = taskId ?? 位置`；`sourceKey` 有 id 用 id
- `addPlanTask(podId, goalId, waveId|null, title, acceptance?)`
- `deleteTask(podId, taskId)`（计划 → 写盘；手工 → 只删行）
- `migrateLegacyTaskKeys` / `updateTaskSourceKey` / `deleteTask`（store）
- 共用 `loadEditablePlan` 门

## Task 4 — 路由 + 契约

文件：`gateway/src/routes/pods.ts`、`pod-handlers.ts`、`route-catalog.ts`

- `DELETE /api/pods/:podId/tasks/:taskId`
- `POST .../tasks` 增 `plan:true` 分支
- `emit:openapi` 重新生成 `gateway-paths.json` / `openapi.json`

## Task 5 — SDK / preload

- `PodTask` 已有 `acceptanceJson?`
- `createTask` body 增 `plan/waveId/acceptance`
- 新增 `deleteTask`
- preload 透传

## Task 6 — 桌面

- `PodTaskBoard`：新建模式「手工 / 加入计划」；任务卡「删除」两步确认
- `PodDock`：`createPlanTask` / `deleteTask` + 409/400 文案
- `podActiveGoalId` 纯函数 + 测试

## Task 7 — 文档

- `CONTEXT.md`：任务板可增删（仅当前轮、稳定 id）
- `AGENTS.md`：本批条目（测试数 + commits）

## 门禁

- `gateway`: `npx tsc --noEmit` + `npm test -- --runInBand --forceExit`
- `desktop`: `npm test` + `tsgo -p` + `electron-vite build`
- `packages/gateway-sdk`: `npm test` + `npm run build`
- `gateway/tests/unit/api-contract.test.ts`
