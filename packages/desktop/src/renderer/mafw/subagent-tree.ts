import type { SubagentRow } from "./subagent-tracker"

/**
 * 当前会话的完整后代树（含孙代理），按 tracker 输入顺序（startedAt 倒序）。
 * 只返回已知行；缺失的中间层不会凭空补，避免假血缘。
 */
export function descendantRows(rows: SubagentRow[], rootID: string): SubagentRow[] {
  if (!rootID) return []
  const byParent = new Map<string, SubagentRow[]>()
  for (const row of rows) {
    const list = byParent.get(row.parentID) ?? []
    list.push(row)
    byParent.set(row.parentID, list)
  }
  const out: SubagentRow[] = []
  const seen = new Set<string>([rootID])
  const walk = (parentID: string) => {
    for (const child of byParent.get(parentID) ?? []) {
      if (seen.has(child.childID)) continue
      seen.add(child.childID)
      out.push(child)
      walk(child.childID)
    }
  }
  walk(rootID)
  return out
}
