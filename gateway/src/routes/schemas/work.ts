/**
 * E10-2 `GET /api/projects/:projectId/work` 响应 schema（TypeBox）。
 *
 * 形状来源：`routes/pod-work.ts` `handlePodWork()` —— 五桶分组 + 同源 counts + total：
 *   `{ projectDir, podId, groups: {<bucket>: PodGoalView[]}, counts: {<bucket>: number}, total }`
 * 其中 `groups[bucket]` 与 `pods.goals` 的 `items` 是同一份 `PodGoalView[]`（同一
 * `goals.views()` 投影），因此复用 `PodGoalSchema`；`counts[bucket]` 恒等于该桶长度
 * （两者是同一数组的两个投影，handler 不允许截断）。
 *
 * 消费方：mobile `WorkOverview.fromJson`（`mobile/lib/src/models/pod_models.dart`）
 * 只读取这 5 个 bucket + counts 数字（未知 bucket 宽容跳过）；desktop
 * `WorldOverviewStage` 走 SDK `PodWorkOverview`。二者都与本 schema 一致（不需要额外
 * 字段），因此按 handler 的严格形状建模，不做边界放宽。
 */
import { Type } from '@sinclair/typebox'
import { PodGoalSchema } from './pods'

export const WorkOverviewResponse = Type.Object({
  projectDir: Type.String(),
  podId: Type.String(),
  groups: Type.Object({
    needs_you: Type.Array(PodGoalSchema),
    queued: Type.Array(PodGoalSchema),
    in_progress: Type.Array(PodGoalSchema),
    result_ready: Type.Array(PodGoalSchema),
    ended: Type.Array(PodGoalSchema),
  }),
  counts: Type.Object({
    needs_you: Type.Number(),
    queued: Type.Number(),
    in_progress: Type.Number(),
    result_ready: Type.Number(),
    ended: Type.Number(),
  }),
  total: Type.Number(),
})
