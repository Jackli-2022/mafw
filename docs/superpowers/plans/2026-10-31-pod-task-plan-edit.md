# Pod 任务板可编辑 — 实施计划

- 日期：2026-10-31
- 设计：`docs/superpowers/specs/2026-10-31-pod-task-plan-edit-design.md`
- 方式：TDD 先行，每 Task 一次 commit；桌面与 gateway 分开跑测试

## Task 1 — `editWaveTask` 纯函数

文件：`gateway/src/core/goal/wave-plan-edit.ts` + `gateway/tests/unit/goal/wave-plan-edit.test.ts`

- `findWaveTask(plan, externalTaskId)` → `{ waveIndex, taskIndex } | null`
- `editWaveTask(plan, externalTaskId, patch)` → 新 plan | null
  - 字符串任务 + acceptance → 升级为 `{title, acceptance}`
  - acceptance 为空数组 → 删除该字段
  - 不改其他任务（不可变）

## Task 2 — `pod_tasks.acceptance_json` 列

文件：`gateway/src/core/pod/pod-store.ts` + `gateway/tests/unit/pod/pod-store.test.ts`

- `PodTaskRow.acceptanceJson`
- `ensureColumn('pod_tasks','acceptance_json','acceptance_json TEXT')`
- `upsertTask` 插入/冲突更新都带上；`taskFromRow` 映射

## Task 3 — `PodTaskService.projectWaves` 写验收 + `editPlanTask`

文件：`gateway/src/core/pod/pod-task-service.ts` + 测试

- `projectWaves` 写 `acceptanceJson`
- `editPlanTask(podId, taskId, patch)`：门（终态/运行中）→ 写盘 → 重投影 → 返回任务
- deps 新增 `resolveGoalPlan?(goalId)`（index 注入）

## Task 4 — 路由分支

文件：`gateway/src/routes/pods.ts` + `gateway/tests/unit/pod/pod-routes*.test.ts`

- body 含 `title`/`acceptance` → Lead 权限 + `editPlanTask`
- 与 status/owner 混传 400

## Task 5 — index 接线

文件：`gateway/src/index.ts`

- `resolveGoalPlan` 用 `findGoalStatePath` + `loadGoalState`
- `deps.tasks` Pick 加 `editPlanTask`

## Task 6 — SDK / preload 类型

文件：`packages/gateway-sdk/src/types.ts`、`client.ts`（+ contract 若需要）

- `PodTask.acceptanceJson: string | null`
- `updateTask` body 增 `title?` / `acceptance?`

## Task 7 — 桌面编辑 UI

文件：`packages/desktop/src/renderer/mafw/pod-model.ts`、`components/PodTaskBoard.tsx`、`components/PodDock.tsx` + 测试

- `podTaskAcceptance(task)` / `parseAcceptanceLines(text)` / `formatAcceptanceLines(list)`
- 任务卡「编辑」→ 标题 + 验收 textarea → 保存
- 409/400 toast 显示原因
- 仅 `goalId && externalTaskId` 显示编辑

## Task 8 — 文档

- `CONTEXT.md`：Pod 记忆与谐波记忆拆层 + 任务状态不进长期记忆
- `AGENTS.md`：五层表 + 本批条目（含测试数与 commit）

## 门禁

- `gateway`: `npx tsc --noEmit` + `npm test -- --runInBand --forceExit`
- `desktop`: `npm test` + `npx tsgo --noEmit -p tsconfig.json` + `npx electron-vite build`
- `sdk`: `npm test`
- 全绿后一次 `deploy:local`（可选）与版本号记录
