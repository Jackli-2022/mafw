// packages/desktop/src/renderer/mafw/checkpoint-rev.ts
// session.checkpoint 事件 → CheckpointOverlay 刷新的模块单例 signal
//（模式同 goals-rev：SSE bump，打开中的 overlay 订阅重拉 serverCheckpoints）。
// W0-1（2026-10-28）：修复 overlay 打开期间 gateway 自动检查点不实时出现的问题。
import { createSignal } from "solid-js"

const [checkpointRev, setCheckpointRev] = createSignal(0)
export { checkpointRev }
export function bumpCheckpointRev(): void { setCheckpointRev((v) => v + 1) }
