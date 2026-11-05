// packages/desktop/src/shared/navigate-goal.ts
// main → renderer：托盘菜单 / OS 通知点击后打开某个 Goal。
// 跨项目时 renderer 先切项目（projectId 是项目目录），再打开统一 Goal 详情。
export interface NavigateGoalTarget {
  goalId: string
  podId?: string
  /** 项目目录（gateway 的 projectId 就是目录路径）；缺省表示当前项目。 */
  projectId?: string
}
