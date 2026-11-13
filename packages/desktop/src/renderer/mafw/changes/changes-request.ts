// 深链请求：Goal 页 / 讨论 turn 卡片 → 左栏改动面。
import type { ChangesContext } from "./changes-context"

export type ChangesRequest = {
  seq: number
  context: ChangesContext
  section?: "review" | "changes"
  rel?: string
  line?: number
}

export function nextChangesRequest(
  previous: ChangesRequest | null,
  input: Omit<ChangesRequest, "seq">,
): ChangesRequest {
  return { ...input, seq: (previous?.seq ?? 0) + 1 }
}
