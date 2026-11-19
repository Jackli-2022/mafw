// Single presentation contract for ChatView tool cards. Pure logic: no Solid
// hooks and no JSX, so bun/node tests can import it directly.
import type { ToolProps } from "./message-part"

export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface ToolMeta {
  text: string
  tone?: "ok" | "warn" | "err" | "muted" | "accent"
}

export interface ToolAction {
  kind: "open-subagent" | "answer" | "link" | "custom"
  label?: string
  href?: string
  sessionID?: string
  questionID?: string
  run?: () => void
}

export type Section =
  | { kind: "kv"; rows: Array<[string, string]> }
  | { kind: "tags"; items: string[] }
  | { kind: "text"; text: string; tone?: "muted" | "warn" | "error" }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; items: ListItem[] }

export interface ListItem {
  title: string
  subtitle?: string
  badge?: string
  badgeTone?: "ok" | "warn" | "err" | "muted" | "accent"
}

export interface ToolBadge {
  text: string
  tone?: "ok" | "warn" | "err" | "muted"
}

/** Collapsed state: always one line. */
export interface ToolCollapsedPresentation {
  title: string
  /** Relative path / command / query / URL; ellipsized with an 8px fade. */
  object?: string
  /** Right-side badges / counts. */
  meta?: ToolMeta[]
  status: ToolStatus
  /** Reserved for a future family marker; not rendered by default. */
  icon?: string
}

/** Expanded state: the body below the one-line collapsed row. */
export interface ToolExpandedPresentation {
  /**
   * default = generic input JSON + output text.
   * Missing body always resolves to "default", never an empty body.
   */
  body?: "default" | "markdown" | "terminal" | "json" | "diff" | "custom"
  sections?: Section[]
  actions?: ToolAction[]
}

/**
 * Both states are optional. `resolvePresentation()` merges the explicit
 * defaults from this module, so a tool can never have an undefined state.
 */
export interface ToolPresentation {
  collapsed?: Partial<ToolCollapsedPresentation>
  expanded?: Partial<ToolExpandedPresentation>
}

export interface ResolvedToolPresentation {
  collapsed: ToolCollapsedPresentation
  expanded: ToolExpandedPresentation
}

export interface ToolPresentationContext {
  props: ToolProps
  directory?: string
  mode: "chat" | "context" | "timeline"
  t: (key: string, params?: Record<string, string | number | boolean>) => string
  sessionHref?: (sessionID: string) => string | undefined
  agent?: (name?: string) => { name: string; color?: string; v2Color?: string } | undefined
}

export type ToolPresenter = (ctx: ToolPresentationContext) => ToolPresentation

export function statusOf(props: ToolProps): ToolStatus {
  if (props.status === "pending" || props.status === "running" || props.status === "error") return props.status
  return "completed"
}

export function defaultCollapsed(ctx: ToolPresentationContext): ToolCollapsedPresentation {
  return { title: ctx.props.tool, status: statusOf(ctx.props) }
}

export const DEFAULT_EXPANDED: ToolExpandedPresentation = { body: "default" }

export function resolvePresentation(
  raw: ToolPresentation | undefined,
  ctx: ToolPresentationContext,
): ResolvedToolPresentation {
  return {
    collapsed: { ...defaultCollapsed(ctx), ...raw?.collapsed },
    expanded: { ...DEFAULT_EXPANDED, ...raw?.expanded },
  }
}

/** History tool parts carry output in `state.content[]`, not `state.output`. */
export function partOutputText(state: any): string | undefined {
  if (typeof state?.output === "string" && state.output.length > 0) return state.output
  if (Array.isArray(state?.content)) {
    const text = state.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
    return text || undefined
  }
  return undefined
}
