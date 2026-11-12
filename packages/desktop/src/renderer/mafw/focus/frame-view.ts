// 框的纯视图模型：把世界 / scope / 对象 / 版本 / 状态压成一条可渲染的视图。
// 不读 DOM、不读存储，方便被 MafwShell 和测试共用。
export type FrameCrumb = {
  label: string
  kind: "world" | "scope" | "subject" | "anchor"
  stackIndex?: number
}

export type FrameBadge = {
  id: "dirty" | "stale" | "unresolved" | "revision" | "execution" | "version" | "external" | "verdict"
  label: string
  tone: "neutral" | "amber" | "red" | "green"
}

export type FrameView = {
  crumbs: FrameCrumb[]
  badges: FrameBadge[]
}

export type FrameInput = {
  worldName: string
  scopeLabel: string
  subjectLabel: string
  anchorLabel?: string
  /** -1 表示栈里没有世界根（旧持久化栈），不渲染世界面包屑。 */
  worldIndex?: number
  scopeStartIndex?: number
  subjectIndex?: number
  dirty?: boolean
  stale?: boolean
  unresolved?: number
  revision?: number
  execution?: { label: string; tone: "neutral" | "amber" | "red" | "green" }
  version?: string
  external?: boolean
  verdict?: string
}

function verdictTone(verdict: string): FrameBadge["tone"] {
  if (verdict === "PASS") return "green"
  if (verdict === "FAIL") return "red"
  return "neutral"
}

export function frameView(input: FrameInput): FrameView {
  const worldIndex = input.worldIndex ?? 0
  const crumbs: FrameCrumb[] = []
  if (worldIndex >= 0) {
    crumbs.push({ label: input.worldName, kind: "world", stackIndex: worldIndex })
  }
  crumbs.push(
    { label: input.scopeLabel, kind: "scope", stackIndex: input.scopeStartIndex ?? 0 },
    { label: input.subjectLabel, kind: "subject", stackIndex: input.subjectIndex },
  )
  if (input.anchorLabel) {
    crumbs.push({ label: input.anchorLabel, kind: "anchor" })
  }

  const badges: FrameBadge[] = []
  if (input.dirty) badges.push({ id: "dirty", label: "dirty", tone: "amber" })
  if (input.stale) badges.push({ id: "stale", label: "stale", tone: "amber" })
  if (input.unresolved !== undefined && input.unresolved > 0) {
    badges.push({ id: "unresolved", label: `${input.unresolved} unresolved`, tone: "red" })
  }
  if (input.revision !== undefined) {
    badges.push({ id: "revision", label: `rev ${input.revision}`, tone: "neutral" })
  }
  if (input.execution) {
    badges.push({ id: "execution", label: input.execution.label, tone: input.execution.tone })
  }
  if (input.version) {
    badges.push({ id: "version", label: input.version, tone: "neutral" })
  }
  if (input.external) badges.push({ id: "external", label: "external", tone: "neutral" })
  if (input.verdict) {
    badges.push({ id: "verdict", label: input.verdict, tone: verdictTone(input.verdict) })
  }

  return { crumbs, badges }
}
