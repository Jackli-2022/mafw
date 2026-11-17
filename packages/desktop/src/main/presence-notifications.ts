import type { NotificationHub } from "./notification-hub"
import { attentionTarget, type AttentionKind } from "./notification-target"

export interface PresenceAttentionLike {
  id: string
  goalId: string
  revision: number
  kind: AttentionKind
  title: string
  projectId?: string
}

export interface PresenceResultLike {
  goalId: string
  revision: number
  title: string
  podId?: string
  projectId?: string
}

export interface PresencePayloadLike {
  // Older gateways type attention items as `{ id }`; validate at runtime.
  attention?: { items?: Array<Partial<PresenceAttentionLike> & { id: string }> }
  unreadResults?: { latest?: Partial<PresenceResultLike> | null }
}

const ATTENTION_KINDS = new Set<AttentionKind>([
  "plan_approval",
  "direction_review",
  "question",
  "blocked",
  "review",
  "failed",
])

function attentionBody(kind: AttentionKind): string {
  switch (kind) {
    case "plan_approval":
      return "计划待批准"
    case "direction_review":
      return "方向待裁定"
    case "question":
      return "等待你的回答"
    case "blocked":
      return "Goal 被阻塞"
    case "review":
      return "等待评审"
    case "failed":
      return "Goal 失败"
  }
}

function normalizeAttention(
  item: Partial<PresenceAttentionLike> & { id: string },
): PresenceAttentionLike | null {
  if (typeof item.goalId !== "string" || !item.goalId) return null
  if (typeof item.revision !== "number" || !Number.isFinite(item.revision)) return null
  if (!ATTENTION_KINDS.has(item.kind as AttentionKind)) return null
  const normalized: PresenceAttentionLike = {
    id: item.id,
    goalId: item.goalId,
    revision: item.revision,
    kind: item.kind as AttentionKind,
    title: typeof item.title === "string" && item.title ? item.title : "需要你",
  }
  if (typeof item.projectId === "string" && item.projectId) normalized.projectId = item.projectId
  return normalized
}

function normalizeLatest(latest: Partial<PresenceResultLike> | null | undefined): PresenceResultLike | null {
  if (!latest) return null
  if (typeof latest.goalId !== "string" || !latest.goalId) return null
  if (typeof latest.revision !== "number" || !Number.isFinite(latest.revision)) return null
  const normalized: PresenceResultLike = {
    goalId: latest.goalId,
    revision: latest.revision,
    title: typeof latest.title === "string" ? latest.title : "Goal",
  }
  if (typeof latest.podId === "string") normalized.podId = latest.podId
  if (typeof latest.projectId === "string") normalized.projectId = latest.projectId
  return normalized
}

/**
 * Map a presence snapshot into hub notifications. Presence remains the only
 * source of p1/p2 events; the hub is the once-only + read-state ledger.
 */
export function publishPresenceNotifications(
  hub: NotificationHub,
  payload: PresencePayloadLike | null,
): void {
  if (!payload) return
  const items = (payload.attention?.items ?? [])
    .map(normalizeAttention)
    .filter((item): item is PresenceAttentionLike => !!item)
  const latest = normalizeLatest(payload.unreadResults?.latest)

  for (const item of items) {
    // A failed Goal already has a p1 result entry; do not double-notify.
    if (
      latest &&
      item.kind === "failed" &&
      item.goalId === latest.goalId &&
      item.revision === latest.revision
    ) {
      continue
    }
    hub.publish({
      kind: "attention",
      severity: "p2",
      title: item.title,
      body: attentionBody(item.kind),
      reason: "需要你",
      projectId: item.projectId,
      target: attentionTarget({
        kind: item.kind,
        goalId: item.goalId,
        projectId: item.projectId,
      }),
      dedupeKey: item.id,
    })
  }

  if (latest) {
    hub.publish({
      kind: "goal_result",
      severity: "p1",
      title: `${latest.title?.trim() || "Goal"} · 结果就绪`,
      body: "Goal 已归档，点击查看结果",
      reason: "Goal 结果",
      projectId: latest.projectId,
      target: { type: "goal", goalId: latest.goalId, projectId: latest.projectId, focus: "result" },
      dedupeKey: `${latest.goalId}:r${latest.revision}`,
    })
  }

  // Presence is authoritative for "still needs you"; anything absent resolved.
  hub.reconcileAttention(items.map((item) => item.id))
}
