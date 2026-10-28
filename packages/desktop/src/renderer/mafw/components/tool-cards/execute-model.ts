import { TOOL_SPECS, trunc } from "./extract"

export type ExecuteCallStatus = "running" | "completed" | "error"

export interface ExecuteCall {
  tool: string
  status: ExecuteCallStatus
  input?: Record<string, any>
}

const STATUSES = new Set<ExecuteCallStatus>(["running", "completed", "error"])

/** Code Mode publishes nested calls through metadata.toolCalls, not child parts. */
export function executeCalls(metadata: any): ExecuteCall[] {
  const calls = metadata?.toolCalls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call: any) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return []
    if (typeof call.tool !== "string" || !call.tool) return []
    if (!STATUSES.has(call.status)) return []
    const input =
      call.input && typeof call.input === "object" && !Array.isArray(call.input) ? call.input : undefined
    return [{ tool: call.tool, status: call.status as ExecuteCallStatus, ...(input ? { input } : {}) }]
  })
}

/** Model-facing paths are dotted (`mafw.mafw_get_axioms`); card keys are bare. */
export function normalizeExecuteToolName(tool: string): string {
  const name = tool.trim()
  if (name.startsWith("mafw.") && name.length > "mafw.".length) return name.slice("mafw.".length)
  return name
}

export function executeToolLabel(tool: string): string {
  const name = normalizeExecuteToolName(tool)
  return TOOL_SPECS[name]?.title ?? name
}

export function executeToolIcon(tool: string): string {
  return TOOL_SPECS[normalizeExecuteToolName(tool)]?.icon ?? "mcp"
}

const SKIP_ARGS = new Set(["code", "content", "oldString", "newString", "patch"])

/** Compact `key=value` args for a child call; never dump code/content. */
export function executeCallArgs(input: Record<string, any> | undefined, max = 3, maxLen = 80): string[] {
  if (!input) return []
  const args: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (SKIP_ARGS.has(key)) continue
    let shown: string | undefined
    if (typeof value === "string") shown = value
    else if (typeof value === "number" || typeof value === "boolean") shown = String(value)
    else if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    ) {
      shown = value.join(", ")
    }
    if (shown === undefined) continue
    args.push(`${key}=${trunc(shown.replace(/\s+/g, " "), maxLen)}`)
    if (args.length >= max) break
  }
  return args
}

/** Collapsed header: failed call first, else the latest call. */
export function executeHeaderSubtitle(calls: readonly ExecuteCall[]): string | undefined {
  const call = calls.find((item) => item.status === "error") ?? calls.at(-1)
  if (!call) return
  const args = executeCallArgs(call.input)
  const label = executeToolLabel(call.tool)
  return args.length ? `${label} [${args.join(", ")}]` : label
}

export interface ExecuteOutputView {
  preview: string
  truncated: boolean
  chars: number
  lines: number
}

/** Bound the execute result rendered inline; the full text stays available behind
 * an explicit expand action so a huge JSON payload cannot block the next stream. */
export function executeOutputView(output: string | undefined, maxChars = 8000, maxLines = 200): ExecuteOutputView {
  const text = output ?? ""
  if (text === "") return { preview: "", truncated: false, chars: 0, lines: 0 }
  const lines = text.split("\n").length
  const chars = text.length
  if (chars <= maxChars && lines <= maxLines) return { preview: text, truncated: false, chars, lines }
  const byChars = text.slice(0, maxChars)
  const byLines = text.split("\n").slice(0, maxLines).join("\n")
  return {
    preview: byChars.length <= byLines.length ? byChars : byLines,
    truncated: true,
    chars,
    lines,
  }
}
