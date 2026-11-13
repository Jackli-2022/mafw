// 深链请求：Goal 页 / 讨论 turn 卡片 → 左栏改动面。
export type ChangesRequest = {
  seq: number
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
