// 摄取层：tool part → 规范视图（渲染层只读）。
//
// 吸收的形状差异（Task 9 §7 清单）：
// - v2.1 part 只有 `name`（subagent/shell），补 `tool`；
// - 历史 `state.content[]` → 规范 `state.output`；
// - `metadata.files` / `filediff` / `diff`（apply_patch 的 filePath/relativePath/type）
//   → `metadata.files: CanonicalFileDiff[]`；
// - task/subagent 子会话 id 三套键（sessionId/sessionID/childSessionID）→ `metadata.sessionID`；
// - task 的 agent 两套键（subagent_type/agent）→ `input.agent`。
import { canonicalFileDiffList, type CanonicalFileDiff } from "./files"
import { toolNameOf } from "../tool-part"

const FILE_DIFF_TOOLS = new Set([
  "edit",
  "write",
  "apply_patch",
  "multiedit",
  "patch",
  "file_change",
  "create",
])

function readInputPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const value = input as Record<string, unknown>
  const candidate = value.filePath ?? value.path ?? value.file_path
  return typeof candidate === "string" && candidate ? candidate : undefined
}

function textFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part: any) => part && part.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text as string)
    .join("\n")
  return text.trim() ? text : undefined
}

function withCanonicalFiles(
  metadata: Record<string, unknown>,
  fallbackFile: string | undefined,
): Record<string, unknown> {
  const files: CanonicalFileDiff[] = canonicalFileDiffList(metadata, fallbackFile)
  if (files.length === 0) return metadata
  // 只保留规范键；legacy filediff/diff 不再向下游泄漏。
  const { filediff: _filediff, diff: _diff, ...rest } = metadata
  return { ...rest, files }
}

function canonicalTaskMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (typeof metadata.sessionID === "string" && metadata.sessionID) return metadata
  for (const key of ["sessionId", "childSessionID"] as const) {
    const value = metadata[key]
    if (typeof value === "string" && value) {
      const { sessionId: _sessionId, childSessionID: _child, ...rest } = metadata
      return { ...rest, sessionID: value }
    }
  }
  return metadata
}

function canonicalTaskInput(input: Record<string, unknown>): Record<string, unknown> {
  const direct = input.subagent_type
  if (typeof input.agent === "string" && input.agent) {
    const { subagent_type: _subagent, ...rest } = input
    return rest
  }
  if (typeof direct === "string" && direct) {
    const { subagent_type: _subagent, ...rest } = input
    return { ...rest, agent: direct }
  }
  return input
}

/** 单个 tool part → 规范 part（幂等；非 tool part 原样返回）。 */
export function canonicalToolPart(part: any): any {
  if (!part || part.type !== "tool") return part
  const tool = toolNameOf(part)
  if (!tool) return part
  const state = part.state && typeof part.state === "object" ? { ...part.state } : part.state
  let out: any = part.tool === tool ? part : { ...part, tool }
  if (!state) return out

  let stateChanged = false
  if (typeof state.output !== "string") {
    const output = textFromContent(state.content)
    if (output !== undefined) {
      state.output = output
      stateChanged = true
    }
  }

  const fallbackFile = readInputPath(state.input)
  const lowered = tool.toLowerCase()
  const looksLikeFileTool =
    FILE_DIFF_TOOLS.has(lowered) ||
    (state.metadata && typeof state.metadata === "object" &&
      ("files" in state.metadata || "filediff" in state.metadata || "diff" in state.metadata))
  if (state.metadata && typeof state.metadata === "object") {
    let metadata = state.metadata as Record<string, unknown>
    if (lowered === "task" || lowered === "subagent") metadata = canonicalTaskMetadata(metadata)
    if (looksLikeFileTool) metadata = withCanonicalFiles(metadata, fallbackFile)
    if (metadata !== state.metadata) {
      state.metadata = metadata
      stateChanged = true
    }
  }

  if ((lowered === "task" || lowered === "subagent") && state.input && typeof state.input === "object") {
    const input = canonicalTaskInput(state.input as Record<string, unknown>)
    if (input !== state.input) {
      state.input = input
      stateChanged = true
    }
  }

  if (stateChanged) out = { ...out, state }
  return out
}
