// packages/desktop/src/renderer/mafw/goals-rev.ts
// Goal 事件 → UI 刷新的模块单例 signal（SSE bump，Overlay/Dashboard 订阅重拉）。
import { createSignal } from "solid-js"

const [goalsRev, setGoalsRev] = createSignal(0)
export { goalsRev }
export function bumpGoalsRev(): void { setGoalsRev((v) => v + 1) }
