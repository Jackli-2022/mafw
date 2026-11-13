// 左栏「改动」面使用的 Goal 引用：纯模型，不依赖 Solid / window。
// 左栏已改为项目级 Goal-first 树，不再有 session / goal / project 三上下文模式。
export type GoalRef = {
  podId: string
  goalId: string
  revision: number
  title: string
  worktreeDir: string | null
}
