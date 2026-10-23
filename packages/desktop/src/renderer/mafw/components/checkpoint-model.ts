// Checkpoint 模型（纯函数）：已持久化 user 回合 → 时间线行。
// 只覆盖已加载的消息窗口；30 天为 UI 过滤，不删数据。
// 本地/乐观消息（user-/local-/queued-）不建 checkpoint，避免拿不存在的 messageID 回滚。
import { isLocalMessageId } from "../chat/local-id"

export const CHECKPOINT_RETENTION_DAYS = 30

export interface CheckpointFile {
  file: string
  additions?: number
  deletions?: number
  status?: string
  patch?: string
}

export interface Checkpoint {
  messageID: string
  createdAt: number | null
  prompt: string
  files: CheckpointFile[]
  /** 该回合是否带可用的回合级文件摘要（summary.diffs） */
  filesKnown: boolean
}

export function promptTextOf(message: any, parts: Record<string, any[]>): string {
  const direct = typeof message?.text === "string" ? message.text.trim() : ""
  if (direct) return direct
  const list = parts?.[message?.id]
  if (Array.isArray(list)) {
    const text = list
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text as string)
      .join("\n")
      .trim()
    if (text) return text
  }
  return "(无文本)"
}

function checkpointFiles(message: any): { files: CheckpointFile[]; known: boolean } {
  const diffs = message?.summary?.diffs
  if (!Array.isArray(diffs)) return { files: [], known: false }
  const files: CheckpointFile[] = []
  for (const d of diffs) {
    if (!d || typeof d.file !== "string" || !d.file) continue
    const file: CheckpointFile = { file: d.file }
    if (typeof d.additions === "number") file.additions = d.additions
    if (typeof d.deletions === "number") file.deletions = d.deletions
    if (typeof d.status === "string") file.status = d.status
    if (typeof d.patch === "string" && d.patch) file.patch = d.patch
    files.push(file)
  }
  return { files, known: true }
}

export function buildCheckpoints(
  messages: any[],
  parts: Record<string, any[]>,
  now: number,
  retentionDays = CHECKPOINT_RETENTION_DAYS,
): Checkpoint[] {
  const cutoff = now - retentionDays * 86_400_000
  const out: Checkpoint[] = []
  for (const m of messages ?? []) {
    if (!m || m.role !== "user") continue
    const id = typeof m.id === "string" ? m.id : ""
    if (!id || isLocalMessageId(id)) continue
    const createdAt = typeof m.time?.created === "number" ? m.time.created : null
    if (createdAt !== null && createdAt < cutoff) continue
    const { files, known } = checkpointFiles(m)
    out.push({
      messageID: id,
      createdAt,
      prompt: promptTextOf(m, parts),
      files,
      filesKnown: known,
    })
  }
  out.sort((a, b) => {
    if (a.createdAt === null && b.createdAt === null) return 0
    if (a.createdAt === null) return 1
    if (b.createdAt === null) return -1
    return b.createdAt - a.createdAt
  })
  return out
}
